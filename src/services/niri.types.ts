/**
 * Type definitions for the niri IPC protocol.
 *
 * These mirror the JSON emitted by niri's `Request`, `Response` and `Event`
 * enums, verified against niri 26.04. Serde encodes Rust enums as externally
 * tagged objects -- `Event::WindowClosed { id }` becomes `{"WindowClosed":{"id":1}}` --
 * while unit variants are encoded as bare strings, e.g. `"EventStream"`.
 */

export type WorkspaceId = number
export type WindowId = number
export type OutputName = string

export interface Workspace {
  id: WorkspaceId
  /** 1-based index of the workspace on its own output. Not stable across moves. */
  idx: number
  name: string | null
  output: OutputName | null
  is_urgent: boolean
  /** Active on its output. Every output has exactly one active workspace. */
  is_active: boolean
  /** Active *and* on the output that currently holds keyboard focus. */
  is_focused: boolean
  active_window_id: WindowId | null
}

export interface WindowLayout {
  /** `[column, row]`, 1-based, in niri's scrolling layout. */
  pos_in_scrolling_layout: [number, number] | null
  tile_size: [number, number]
  window_size: [number, number]
  tile_pos_in_workspace_view: [number, number] | null
  window_offset_in_tile: [number, number]
}

export interface Window {
  id: WindowId
  title: string | null
  app_id: string | null
  pid: number | null
  workspace_id: WorkspaceId | null
  is_focused: boolean
  is_floating: boolean
  is_urgent: boolean
  layout?: WindowLayout
  focus_timestamp?: { secs: number; nanos: number } | null
}

export interface KeyboardLayouts {
  names: string[]
  current_idx: number
}

export interface LogicalOutput {
  x: number
  y: number
  width: number
  height: number
  scale: number
  transform: string
}

export interface Output {
  name: OutputName
  make: string | null
  model: string | null
  serial: string | null
  physical_size: [number, number] | null
  logical: LogicalOutput | null
  vrr_supported: boolean
  vrr_enabled: boolean
}

/** What a screencast is capturing. `Nothing` means it has not been set yet. */
export type CastTarget =
  | { Nothing: Record<string, never> }
  | { Output: { name: OutputName } }
  | { Window: { id: WindowId } }

/** One screencast stream the compositor is serving. */
export interface Cast {
  stream_id: number
  /** One session can hold several streams; usually it holds one. */
  session_id: number
  /** `PipeWire` for a portal screencast, `WlrScreencopy` for wf-recorder and friends. */
  kind: "PipeWire" | "WlrScreencopy"
  target: CastTarget
  is_dynamic_target: boolean
  /**
   * Whether frames are actually flowing. False while a consumer has the stream
   * open but paused -- OBS on a scene that does not include the capture.
   */
  is_active: boolean
  /** Only wlr-screencopy casts report one. */
  pid: number | null
  pw_node_id: number | null
}

/**
 * Events pushed over an `"EventStream"` connection.
 *
 * niri may add variants in future releases, so consumers must tolerate unknown
 * keys -- the service dispatches on the single key present and ignores the rest.
 */
export type NiriEvent =
  | { WorkspacesChanged: { workspaces: Workspace[] } }
  | { WorkspaceActivated: { id: WorkspaceId; focused: boolean } }
  | { WorkspaceActiveWindowChanged: { workspace_id: WorkspaceId; active_window_id: WindowId | null } }
  | { WorkspaceUrgencyChanged: { id: WorkspaceId; urgent: boolean } }
  | { WindowsChanged: { windows: Window[] } }
  | { WindowOpenedOrChanged: { window: Window } }
  | { WindowClosed: { id: WindowId } }
  | { WindowFocusChanged: { id: WindowId | null } }
  | { WindowUrgencyChanged: { id: WindowId; urgent: boolean } }
  | { WindowLayoutsChanged: { changes: Array<[WindowId, WindowLayout]> } }
  | { KeyboardLayoutsChanged: { keyboard_layouts: KeyboardLayouts } }
  | { KeyboardLayoutSwitched: { idx: number } }
  | { OverviewOpenedOrClosed: { is_open: boolean } }
  | { ConfigLoaded: { failed: boolean } }
  // `CastsChanged` is the wholesale snapshot niri replays on connect; the two
  // that follow are the deltas it pushes afterwards. A consumer that watches
  // only the snapshot never learns that a capture started.
  | { CastsChanged: { casts: Cast[] } }
  | { CastStartedOrChanged: { cast: Cast } }
  | { CastStopped: { stream_id: number } }
  | Record<string, unknown>

/** A reply is `{"Ok": <Response>}` or `{"Err": "<message>"}`. */
export type NiriReply<T = unknown> = { Ok: T } | { Err: string }

/** How an action refers to a workspace. */
export type WorkspaceReference =
  | { Id: WorkspaceId }
  | { Index: number }
  | { Name: string }

/**
 * Requests we issue. This is intentionally a small, typed subset rather than a
 * full mirror of niri's request enum -- add variants here as modules need them.
 */
export type NiriRequest =
  | "Version"
  | "Workspaces"
  | "Windows"
  | "Outputs"
  | "FocusedWindow"
  | "EventStream"
  | "Casts"
  /** Blocks until the user clicks or gives up; answers `PickedColor`. */
  | "PickColor"
  | { Action: NiriAction }

export type NiriAction =
  | { FocusWorkspace: { reference: WorkspaceReference } }
  | { FocusWindow: { id: WindowId } }
  | { CloseWindow: { id: WindowId | null } }
  | { ToggleOverview: Record<string, never> }
  | { SwitchLayout: { layout: "Next" | "Prev" | { Index: number } } }
  | Record<string, unknown>
