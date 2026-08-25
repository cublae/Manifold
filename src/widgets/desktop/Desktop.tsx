import Gdk from "gi://Gdk?version=4.0"
import GLib from "gi://GLib"
import { Astal, Gtk } from "ags/gtk4"
import app from "ags/gtk4/app"
import { createBinding, createComputed, createState } from "ags"
import { createPoll } from "ags/time"
import type AstalMprisNS from "gi://AstalMpris"
import { _ } from "../../lib/i18n"

import * as system from "../../services/system"
import Niri from "../../services/niri"
import {
  adjust,
  clampScale,
  onLayoutChanged,
  placement,
  type Anchor,
  type Placement,
  type WidgetId,
} from "../../services/desktopLayout"
import { config } from "../../config"
import { animationDuration, fade } from "../../lib/animation"
import { captureScope } from "../../lib/scope"
import { editing, setEditingDesktop } from "./edit"

/**
 * Widgets on the desktop itself.
 *
 * A layer-shell surface on `Layer.BACKGROUND`, which puts it above the
 * wallpaper and below every window -- so this is not another thing to move out
 * of the way, it is simply what is there when nothing else is.
 *
 * Which is also the rule for when it shows: only while the monitor's active
 * workspace holds no windows. A clock behind a full-screen editor is a clock
 * nobody can see, and one peeking out beside a half-width window is clutter.
 * niri says what is on each workspace, so there is no guessing.
 *
 * Widgets are placed on a grid and can be dragged around it in edit mode, which
 * the control centre turns on. Editing is the one time the surface takes input:
 * the rest of the time a background layer that swallowed clicks meant for the
 * wallpaper would be a bug nobody could explain.
 */

export interface DesktopProps {
  monitor: Gdk.Monitor
}

/** Ticks once a second so the clock is never visibly behind. */
const clock = createPoll(GLib.DateTime.new_now_local(), 1000, () =>
  GLib.DateTime.new_now_local(),
)

/**
 * Grid resolution, counted in *lines* rather than cells.
 *
 * A widget sits centred on an intersection, so the positions run 0..COLUMNS
 * inclusive. Cells would have no middle column on an even grid, and "centred"
 * is the one placement that has to be exact -- a clock a cell's width off the
 * midline is visibly wrong on a symmetrical wallpaper.
 *
 * Fine enough to place things deliberately, coarse enough that a drag lands
 * where it was aimed.
 */
const COLUMNS = 24
const ROWS = 16

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export default function Desktop({ monitor }: DesktopProps): Astal.Window {
  const inScope = captureScope()
  const cfg = config.get().desktop
  const output = monitor.get_connector() ?? "unknown"

  // -- the widgets ---------------------------------------------------------

  const time = inScope(
    () =>
      (
        <label
          cssClasses={["manifold-desktop-clock"]}
          label={clock((now) => now.format(cfg.clockFormat) ?? "")}
        />
      ) as Gtk.Widget,
  )

  const date = inScope(
    () =>
      (
        <label
          cssClasses={["manifold-desktop-date"]}
          visible={cfg.showDate}
          label={clock((now) => now.format(cfg.dateFormat) ?? "")}
        />
      ) as Gtk.Widget,
  )

  const [playing, setPlaying] = createState<string>("")

  const nowPlaying = inScope(
    () =>
      (
        <box
          cssClasses={["manifold-desktop-media"]}
          spacing={8}
          visible={playing((text) => cfg.showMedia && text !== "")}
        >
          <image iconName="media-playback-start-symbolic" />
          <label label={playing} />
        </box>
      ) as Gtk.Widget,
  )

  if (cfg.showMedia) {
    void (async () => {
      const mpris = await system.mpris()
      if (!mpris) return

      let watched: AstalMprisNS.Player | null = null
      let handlers: number[] = []

      const describe = (player: AstalMprisNS.Player | null): string => {
        // Only what is actually playing. A paused player is not what the
        // desktop is doing, it is what it was doing.
        if (!player || player.playbackStatus !== 0) return ""

        const title = player.title?.trim()
        if (!title) return ""

        const artist = player.artist?.trim()
        return artist ? `${artist} — ${title}` : title
      }

      const sync = () => {
        const player = mpris.get_players()[0] ?? null

        if (player !== watched) {
          for (const id of handlers) watched?.disconnect(id)
          handlers = []
          watched = player

          if (player) {
            handlers = ["notify::title", "notify::artist", "notify::playback-status"].map(
              (signal) => player.connect(signal, () => setPlaying(describe(player))),
            )
          }
        }

        setPlaying(describe(player))
      }

      mpris.connect("notify::players", sync)
      sync()
    })()
  }

  // -- placement -----------------------------------------------------------
  // `Gtk.Fixed` rather than `Gtk.Grid`: a grid sizes its columns to fit their
  // children, so one wide clock would stretch the column it is in and drag
  // every other widget out of line. Here the grid is only arithmetic, and a
  // widget's size never affects where anything else sits.

  const fixed = new Gtk.Fixed({ hexpand: true, vexpand: true })

  interface Piece {
    id: WidgetId
    widget: Gtk.Widget
    /** Wrapper that carries the gestures and the edit-mode outline. */
    frame: Gtk.Widget
    /** Provider holding this piece's scale, swapped out when it changes. */
    style: Gtk.CssProvider | null
  }

  const pieces: Piece[] = []

  /** Pixel position of a grid intersection, given the current allocation. */
  function cellCentre(at: Placement): [number, number] {
    const width = fixed.get_width() || monitor.get_geometry().width
    const height = fixed.get_height() || monitor.get_geometry().height

    return [(at.column / COLUMNS) * width, (at.row / ROWS) * height]
  }

  /** The nearest intersection to a pixel position, as column and row. */
  function cellAt(x: number, y: number): { column: number; row: number } {
    const width = fixed.get_width() || monitor.get_geometry().width
    const height = fixed.get_height() || monitor.get_geometry().height

    return {
      column: clamp(Math.round((x / width) * COLUMNS), 0, COLUMNS),
      row: clamp(Math.round((y / height) * ROWS), 0, ROWS),
    }
  }

  /**
   * How far left of the grid point a piece starts, for its width.
   *
   * `center` is right in the middle of a screen and wrong at its edges: a clock
   * centred on the leftmost line hangs half of itself off the display. The
   * anchor is what lets a widget be tucked into a corner.
   */
  function offsetFor(anchor: Anchor, width: number): number {
    if (anchor === "start") return 0
    if (anchor === "end") return width
    return width / 2
  }

  /**
   * Put a piece where the layout says.
   *
   * Measured rather than allocated, because this also runs before the first
   * allocation -- a widget with no size yet would otherwise land on the grid
   * point itself and jump once it had one.
   */
  function position(piece: Piece): void {
    const at = placement(output, piece.id)
    const [x, y] = cellCentre(at)
    const [, width] = piece.frame.measure(Gtk.Orientation.HORIZONTAL, -1)
    const [, height] = piece.frame.measure(Gtk.Orientation.VERTICAL, -1)

    // Vertically always centred: a row of text reads as sitting *on* the line
    // it is placed at, and there is no edge case to escape as there is
    // horizontally.
    fixed.move(piece.frame, x - offsetFor(at.anchor, width), y - height / 2)
  }

  /**
   * Apply a piece's scale.
   *
   * A percentage `font-size` on the frame rather than a size in pixels: it is
   * inherited, so one rule scales every label inside whatever the stylesheet
   * gave each of them, and the clock and the date keep their relative sizes.
   */
  function rescale(piece: Piece): void {
    const { scale } = placement(output, piece.id)

    if (piece.style) piece.frame.get_style_context().remove_provider(piece.style)

    piece.style = new Gtk.CssProvider()
    piece.style.load_from_string(`* { font-size: ${Math.round(scale * 100)}%; }`)
    piece.frame
      .get_style_context()
      .add_provider(piece.style, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)
  }

  function positionAll(): void {
    for (const piece of pieces) {
      rescale(piece)
      position(piece)
    }
  }

  function addPiece(id: WidgetId, widget: Gtk.Widget, name: string): void {
    const frame = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      cssClasses: ["manifold-desktop-piece"],
    })
    frame.append(widget)

    const piece: Piece = { id, widget, frame, style: null }
    pieces.push(piece)
    fixed.put(frame, 0, 0)

    // A widget with nothing to say -- the media line with nothing playing --
    // is an empty box a few pixels across. That is impossible to grab and says
    // nothing about what it is, so while arranging it stands in for itself.
    const placeholder = inScope(
      () =>
        (
          <label
            cssClasses={["manifold-desktop-placeholder"]}
            visible={createComputed([editing, createBinding(widget, "visible")], (edit, shown) =>
              edit && !shown,
            )}
            label={name}
          />
        ) as Gtk.Widget,
    )
    frame.append(placeholder)
    placeholder.connect("notify::visible", () => position(piece))

    // -- dragging ----------------------------------------------------------
    const drag = new Gtk.GestureDrag()
    let origin: [number, number] = [0, 0]

    // Where the drag had got to when it was last seen moving.
    //
    // `drag-end` carries its own offsets and they cannot be trusted: a sequence
    // that ends with the button release arriving separately from the motion --
    // which is exactly what a synthetic drag looks like, and what a fast real
    // one can look like too -- reports zero, and the widget snaps back to where
    // it started. The last offset actually observed is the one that means
    // something.
    let last: [number, number] = [0, 0]

    drag.connect("drag-begin", () => {
      if (!editing.get()) return
      const [x, y] = cellCentre(placement(output, id))
      origin = [x, y]
      last = [0, 0]
      frame.add_css_class("dragging")
    })

    drag.connect("drag-update", (_gesture, dx: number, dy: number) => {
      if (!editing.get()) return
      last = [dx, dy]

      const at = placement(output, id)
      const [, width] = frame.measure(Gtk.Orientation.HORIZONTAL, -1)
      const [, height] = frame.measure(Gtk.Orientation.VERTICAL, -1)
      fixed.move(
        frame,
        origin[0] + dx - offsetFor(at.anchor, width),
        origin[1] + dy - height / 2,
      )
    })

    drag.connect("drag-end", (_gesture, dx: number, dy: number) => {
      if (!editing.get()) return
      frame.remove_css_class("dragging")

      // Whichever of the two is further from the start: a real drag that ends
      // with a final motion reports it here, and one that does not still has
      // `last`.
      const [ox, oy] =
        Math.hypot(dx, dy) > Math.hypot(last[0], last[1]) ? [dx, dy] : last

      // Snapped from where the widget's anchor point ends up, which is the spot
      // the eye reads it as sitting on.
      adjust(output, id, cellAt(origin[0] + ox, origin[1] + oy))
      positionAll()
    })

    frame.add_controller(drag)

    // -- size --------------------------------------------------------------
    // The wheel, because it is the one gesture that means "more or less of
    // this" without a control to click, and there is nothing to scroll here
    // otherwise.
    const wheel = new Gtk.EventControllerScroll({
      flags: Gtk.EventControllerScrollFlags.VERTICAL,
    })
    wheel.connect("scroll", (_controller, _dx: number, dy: number) => {
      if (!editing.get()) return false

      const at = placement(output, id)
      // A tenth per notch: enough to see, small enough to stop where meant.
      adjust(output, id, { scale: clampScale(at.scale - Math.sign(dy) * 0.1) })
      positionAll()
      return true
    })
    frame.add_controller(wheel)

    // -- anchor ------------------------------------------------------------
    // Right-click cycles it. Three states are too few to be worth a menu, and a
    // menu inside a layer surface holding a keyboard grab is its own problem.
    const secondary = new Gtk.GestureClick({ button: Gdk.BUTTON_SECONDARY })
    secondary.connect("pressed", () => {
      if (!editing.get()) return

      const order: Anchor[] = ["center", "start", "end"]
      const at = placement(output, id)
      const next = order[(order.indexOf(at.anchor) + 1) % order.length]!

      adjust(output, id, { anchor: next })
      positionAll()
    })
    frame.add_controller(secondary)

    // A widget that changes size -- the clock crossing from 9:59 to 10:00 --
    // has to be re-centred, or it drifts.
    frame.connect("notify::width-request", () => position(piece))
    widget.connect("map", () => position(piece))
  }

  addPiece("clock", time, _("Clock"))
  addPiece("date", date, _("Date"))
  addPiece("media", nowPlaying, _("Now playing"))

  // -- the grid, drawn only while editing ----------------------------------
  const guides = new Gtk.DrawingArea({ hexpand: true, vexpand: true })
  guides.set_draw_func((_area, cr, width, height) => {
    if (!editing.get()) return

    cr.setSourceRGBA(1, 1, 1, 0.16)
    cr.setLineWidth(1)

    for (let column = 1; column < COLUMNS; column++) {
      const x = Math.round((column / COLUMNS) * width) + 0.5
      cr.moveTo(x, 0)
      cr.lineTo(x, height)
    }
    for (let row = 1; row < ROWS; row++) {
      const y = Math.round((row / ROWS) * height) + 0.5
      cr.moveTo(0, y)
      cr.lineTo(width, y)
    }
    cr.stroke()
  })

  const hint = new Gtk.Label({
    // Neither the wheel nor the right button announces itself, and a mode whose
    // controls have to be guessed at is a mode nobody uses twice.
    label: _("Drag to move · Scroll to resize · Right-click to align · Esc when done"),
    cssClasses: ["manifold-desktop-hint"],
    halign: Gtk.Align.CENTER,
    valign: Gtk.Align.START,
    visible: false,
  })

  const canvas = new Gtk.Overlay({
    hexpand: true,
    vexpand: true,
    // Carries the colour and the shadow for everything inside it. Widgets are
    // scattered across a `Gtk.Fixed` now, so there is no single box around
    // them to hang the styling on.
    cssClasses: ["manifold-desktop", "manifold-root"],
  })
  canvas.set_child(guides)
  canvas.add_overlay(fixed)
  canvas.add_overlay(hint)

  // -- shown only on an empty workspace, or while editing -------------------
  const niri = Niri.get_default()

  const bare = createComputed(
    [createBinding(niri, "workspaces"), createBinding(niri, "windows"), editing],
    (workspaces, windows, edit) => {
      // Editing has to show the widgets whatever is on screen, or there would
      // be nothing to arrange.
      if (edit) return true

      // The workspace this monitor is showing, which is the active one on this
      // output -- not the focused one, which may be on another screen.
      const active = workspaces.find((w) => w.output === output && w.is_active)
      if (!active) return false

      return !windows.some((window) => window.workspace_id === active.id)
    },
  )

  const reveal = new Gtk.Revealer({
    child: canvas,
    transitionType: fade(),
    transitionDuration: animationDuration(),
    revealChild: false,
  })

  const window = (
    <window
      name={`desktop-${output}`}
      namespace="manifold-desktop"
      cssClasses={["manifold-window", "manifold-desktop-window"]}
      application={app}
      gdkmonitor={monitor}
      anchor={
        Astal.WindowAnchor.TOP |
        Astal.WindowAnchor.BOTTOM |
        Astal.WindowAnchor.LEFT |
        Astal.WindowAnchor.RIGHT
      }
      exclusivity={Astal.Exclusivity.IGNORE}
      layer={Astal.Layer.BACKGROUND}
      keymode={Astal.Keymode.NONE}
      visible
    >
      {reveal}
    </window>
  ) as Astal.Window

  /**
   * Edit mode moves the surface out of the background and back.
   *
   * A background layer receives no input at all, so there is no arranging
   * anything down there: for as long as the mode is on the surface comes up to
   * `TOP` and takes the keyboard, and goes straight back afterwards.
   */
  function applyEditing(on: boolean): void {
    window.layer = on ? Astal.Layer.TOP : Astal.Layer.BACKGROUND
    window.keymode = on ? Astal.Keymode.EXCLUSIVE : Astal.Keymode.NONE
    window.set_can_target(on)

    if (on) canvas.add_css_class("editing")
    else canvas.remove_css_class("editing")

    hint.set_visible(on)

    guides.queue_draw()
    positionAll()
  }

  window.set_can_target(false)

  inScope(() =>
    editing.subscribe(() => {
      applyEditing(editing.get())
    }),
  )

  const keys = new Gtk.EventControllerKey()
  keys.connect("key-pressed", (_controller, keyval: number) => {
    if (!editing.get()) return false
    if (keyval !== Gdk.KEY_Escape && keyval !== Gdk.KEY_Return) return false

    setEditingDesktop(false)
    return true
  })
  window.add_controller(keys)

  inScope(() =>
    bare.subscribe(() => {
      reveal.reveal_child = bare.get()
    }),
  )
  reveal.reveal_child = bare.get()

  // Another monitor's drag, or a reset, moves things here too.
  const unwatch = onLayoutChanged(() => positionAll())
  window.connect("destroy", () => unwatch())

  // Re-centre everything when the surface is first sized, and on any resize.
  fixed.connect("notify::width", () => positionAll())
  fixed.connect("notify::height", () => positionAll())
  GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
    positionAll()
    return GLib.SOURCE_REMOVE
  })

  return window
}
