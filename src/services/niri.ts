import GObject, { register, getter, signal } from "ags/gobject"
import { timeout } from "ags/time"
import type AstalIO from "gi://AstalIO"

import { EventStream, isAvailable, request } from "./niri-socket"
import type {
  Cast,
  KeyboardLayouts,
  NiriEvent,
  Output,
  Window,
  WindowId,
  Workspace,
  WorkspaceId,
  WorkspaceReference,
} from "./niri.types"

/** Reconnect backoff, in milliseconds. The last value repeats indefinitely. */
const BACKOFF_MS = [250, 500, 1000, 2000, 5000]

/**
 * Reactive view of the niri compositor.
 *
 * State is kept in sync through a single long-lived `EventStream` connection.
 * niri opens that stream by replaying the full current state -- `WorkspacesChanged`
 * and `WindowsChanged` arrive immediately after the handshake -- so there is no
 * separate priming query to race against.
 *
 * All mutations funnel through `applyEvent`, which keeps the incremental deltas
 * (`WindowFocusChanged` and friends) consistent with the wholesale snapshots.
 */
@register({ GTypeName: "ManifoldNiri" })
export default class Niri extends GObject.Object {
  private static _instance: Niri | null = null

  /** The process-wide instance. Widgets should use this rather than constructing. */
  static get_default(): Niri {
    if (!Niri._instance) Niri._instance = new Niri()
    return Niri._instance
  }

  private _workspaces: Workspace[] = []
  private _windows: Window[] = []
  private _keyboardLayouts: KeyboardLayouts = { names: [], current_idx: 0 }
  private _overviewOpen = false
  private _casts: Cast[] = []
  private _connected = false

  private stream: EventStream | null = null
  private retry = 0
  private retryTimer: AstalIO.Time | null = null
  private disposed = false

  /** Workspaces across every output, sorted by output then index. */
  @getter(Object)
  get workspaces(): Workspace[] {
    return this._workspaces
  }

  @getter(Object)
  get windows(): Window[] {
    return this._windows
  }

  /** True while the event stream is live. Widgets can grey themselves out. */
  @getter(Boolean)
  get connected(): boolean {
    return this._connected
  }

  @getter(Boolean)
  get overviewOpen(): boolean {
    return this._overviewOpen
  }

  @getter(Object)
  get keyboardLayouts(): KeyboardLayouts {
    return this._keyboardLayouts
  }

  /**
   * Screencasts the compositor is currently serving.
   *
   * This is the compositor's own account of who is capturing the screen, which
   * is the only trustworthy one: a portal session, a wlr-screencopy recorder
   * and a video call all end up here, and nothing that is not capturing can.
   */
  @getter(Object)
  get casts(): Cast[] {
    return this._casts
  }

  /**
   * True while at least one screencast is actually sending frames.
   *
   * A paused cast -- OBS sitting on a scene that does not include the capture --
   * still exists but is not watching, and an indicator that cannot tell the
   * difference is worse than none.
   */
  @getter(Boolean)
  get casting(): boolean {
    return this._casts.some((cast) => cast.is_active)
  }

  /** Display name of the active keyboard layout, e.g. "English (US)". */
  @getter(String)
  get keyboardLayout(): string {
    const { names, current_idx } = this._keyboardLayouts
    return names[current_idx] ?? ""
  }

  @getter<Window | null>(Object)
  get focusedWindow(): Window | null {
    return this._windows.find((w) => w.is_focused) ?? null
  }

  @getter<Workspace | null>(Object)
  get focusedWorkspace(): Workspace | null {
    return this._workspaces.find((w) => w.is_focused) ?? null
  }

  /**
   * Raw event passthrough, for modules that need variants the service ignores.
   *
   * In v3 a signal is declared by decorating a method; calling it emits.
   */
  @signal(Object)
  event(event: NiriEvent): void {
    void event
  }

  constructor() {
    super()
    if (!isAvailable()) {
      console.error("manifold: NIRI_SOCKET is unset; the niri service will stay disconnected")
      return
    }
    this.openStream()
  }

  // -- queries -------------------------------------------------------------

  /** Workspaces belonging to one output, in display order. */
  workspacesOn(output: string | null): Workspace[] {
    if (!output) return this._workspaces
    return this._workspaces.filter((w) => w.output === output)
  }

  windowsOn(workspace: WorkspaceId): Window[] {
    return this._windows.filter((w) => w.workspace_id === workspace)
  }

  window(id: WindowId): Window | null {
    return this._windows.find((w) => w.id === id) ?? null
  }

  /**
   * Outputs, fetched on demand.
   *
   * Output topology is not part of the event stream, so this is a live query
   * rather than cached state.
   */
  async outputs(): Promise<Output[]> {
    const res = await request<{ Outputs: Record<string, Output> }>("Outputs")
    return Object.values(res.Outputs)
  }

  // -- actions -------------------------------------------------------------

  async focusWorkspace(reference: WorkspaceReference): Promise<void> {
    await this.dispatch({ FocusWorkspace: { reference } })
  }

  async focusWorkspaceId(id: WorkspaceId): Promise<void> {
    await this.focusWorkspace({ Id: id })
  }

  async focusWindow(id: WindowId): Promise<void> {
    await this.dispatch({ FocusWindow: { id } })
  }

  async toggleOverview(): Promise<void> {
    await this.dispatch({ ToggleOverview: {} })
  }

  /**
   * Let the user pick a colour off the screen.
   *
   * The compositor owns this: it puts up its own magnifying cursor and reads
   * the pixel from the composited output, which is the only place the true
   * on-screen colour exists. A shell-side picker would have to screenshot,
   * scale and guess, and would be wrong on a fractional-scale output.
   *
   * The reply does not arrive until the user clicks or gives up, so this
   * deliberately has no timeout -- there is no sensible one -- and resolves to
   * null when they press Escape.
   */
  async pickColor(): Promise<[number, number, number] | null> {
    try {
      const res = await request<{ PickedColor: { rgb: [number, number, number] } | null }>(
        "PickColor",
      )
      return res.PickedColor?.rgb ?? null
    } catch (error) {
      console.error(`manifold: could not pick a colour: ${error}`)
      return null
    }
  }

  /** Send an arbitrary niri action. Errors are logged, never thrown at callers. */
  async dispatch(action: Record<string, unknown>): Promise<void> {
    try {
      await request({ Action: action })
    } catch (error) {
      console.error(`manifold: niri action failed: ${error}`)
    }
  }

  // -- stream lifecycle ----------------------------------------------------

  private openStream(): void {
    if (this.disposed) return

    this.stream = new EventStream({
      onConnected: () => {
        this.retry = 0
        this.setConnected(true)
      },
      onEvent: (event) => this.applyEvent(event as NiriEvent),
      onDisconnected: (error) => {
        if (error) console.error(`manifold: niri event stream dropped: ${error}`)
        this.setConnected(false)
        this.scheduleReconnect()
      },
    })

    void this.stream.open()
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.retryTimer !== null) return

    const delay = BACKOFF_MS[Math.min(this.retry, BACKOFF_MS.length - 1)]
    this.retry += 1

    this.retryTimer = timeout(delay, () => {
      this.retryTimer = null
      this.stream?.close()
      this.stream = null
      this.openStream()
    })
  }

  private setConnected(value: boolean): void {
    if (this._connected === value) return
    this._connected = value
    this.notify("connected")
  }

  // -- event application ---------------------------------------------------

  private applyEvent(event: NiriEvent): void {
    const [kind] = Object.keys(event)
    const payload = (event as Record<string, any>)[kind]

    switch (kind) {
      case "WorkspacesChanged":
        this.setWorkspaces(payload.workspaces)
        break

      case "WorkspaceActivated": {
        // Activating a workspace deactivates its siblings on the same output.
        const activated = this._workspaces.find((w) => w.id === payload.id)
        if (!activated) break
        this.setWorkspaces(
          this._workspaces.map((w) => {
            if (w.output !== activated.output) {
              // Focus is exclusive across outputs, activity is not.
              return payload.focused ? { ...w, is_focused: false } : w
            }
            const isThis = w.id === payload.id
            return {
              ...w,
              is_active: isThis,
              is_focused: payload.focused ? isThis : w.is_focused && isThis,
            }
          }),
        )
        break
      }

      case "WorkspaceActiveWindowChanged":
        this.setWorkspaces(
          this._workspaces.map((w) =>
            w.id === payload.workspace_id ? { ...w, active_window_id: payload.active_window_id } : w,
          ),
        )
        break

      case "WorkspaceUrgencyChanged":
        this.setWorkspaces(
          this._workspaces.map((w) => (w.id === payload.id ? { ...w, is_urgent: payload.urgent } : w)),
        )
        break

      case "WindowsChanged":
        this.setWindows(payload.windows)
        break

      case "WindowOpenedOrChanged": {
        const incoming = payload.window as Window
        const known = this._windows.some((w) => w.id === incoming.id)
        let next = known
          ? this._windows.map((w) => (w.id === incoming.id ? incoming : w))
          : [...this._windows, incoming]

        // niri reports focus on the window itself, so clear the previous holder.
        if (incoming.is_focused) {
          next = next.map((w) => (w.id === incoming.id ? w : { ...w, is_focused: false }))
        }
        this.setWindows(next)
        break
      }

      case "WindowClosed":
        this.setWindows(this._windows.filter((w) => w.id !== payload.id))
        break

      case "WindowFocusChanged":
        this.setWindows(this._windows.map((w) => ({ ...w, is_focused: w.id === payload.id })))
        break

      case "WindowUrgencyChanged":
        this.setWindows(
          this._windows.map((w) => (w.id === payload.id ? { ...w, is_urgent: payload.urgent } : w)),
        )
        break

      case "WindowLayoutsChanged": {
        const layouts = new Map<number, any>(payload.changes)
        this.setWindows(
          this._windows.map((w) => (layouts.has(w.id) ? { ...w, layout: layouts.get(w.id) } : w)),
        )
        break
      }

      case "KeyboardLayoutsChanged":
        this._keyboardLayouts = payload.keyboard_layouts
        this.notify("keyboard-layouts")
        this.notify("keyboard-layout")
        break

      case "KeyboardLayoutSwitched":
        this._keyboardLayouts = { ...this._keyboardLayouts, current_idx: payload.idx }
        this.notify("keyboard-layouts")
        this.notify("keyboard-layout")
        break

      case "OverviewOpenedOrClosed":
        if (this._overviewOpen !== payload.is_open) {
          this._overviewOpen = payload.is_open
          this.notify("overview-open")
        }
        break

      // Screencasts follow the same shape as workspaces and windows: one
      // wholesale snapshot on connect, deltas from then on. Watching only
      // `CastsChanged` looks right and never fires again, so an indicator built
      // on it stays dark through every capture.
      case "CastsChanged":
        this.setCasts(payload.casts)
        break

      case "CastStartedOrChanged": {
        const incoming = payload.cast as Cast
        const known = this._casts.some((cast) => cast.stream_id === incoming.stream_id)
        this.setCasts(
          known
            ? this._casts.map((cast) =>
                cast.stream_id === incoming.stream_id ? incoming : cast,
              )
            : [...this._casts, incoming],
        )
        break
      }

      case "CastStopped":
        this.setCasts(this._casts.filter((cast) => cast.stream_id !== payload.stream_id))
        break

      default:
        // Unhandled variants (ConfigLoaded, future additions) still reach
        // subscribers through the `event` signal below.
        break
    }

    this.event(event)
  }

  private setCasts(casts: Cast[]): void {
    const wasCasting = this.casting
    this._casts = casts
    this.notify("casts")
    if (this.casting !== wasCasting) this.notify("casting")
  }

  private setWorkspaces(workspaces: Workspace[]): void {
    this._workspaces = [...workspaces].sort((a, b) => {
      const output = (a.output ?? "").localeCompare(b.output ?? "")
      return output !== 0 ? output : a.idx - b.idx
    })
    this.notify("workspaces")
    this.notify("focused-workspace")
  }

  private setWindows(windows: Window[]): void {
    this._windows = windows
    this.notify("windows")
    this.notify("focused-window")
  }

  destroy(): void {
    this.disposed = true
    this.retryTimer?.cancel()
    this.retryTimer = null
    this.stream?.close()
    this.stream = null
  }
}
