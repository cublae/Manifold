import GLib from "gi://GLib"
import { Gtk } from "ags/gtk4"
import type { Astal } from "ags/gtk4"

import type { BarPosition } from "../../config"
import { animationDuration, fade, slideFrom } from "../../lib/animation"
import { isVertical } from "../../lib/barLayout"
import { registerVisibility } from "./popupVisibility"

/**
 * Give a panel an entrance and an exit.
 *
 * Every dropdown is an already-mapped, screen-filling layer surface with a
 * panel aligned inside it, so the panel can slide within the surface instead of
 * the surface resizing under the compositor -- which is the difference between
 * a smooth animation and a stuttering one.
 *
 * The window stays mapped while the closing slide plays, so `window.visible`
 * stops answering "is this open?". The intent is tracked here and published
 * through the visibility registry.
 */

export interface RevealPanelProps {
  /** The window the panel lives in; its visibility is taken over. */
  window: Astal.Window
  /** The panel itself. It keeps its own size; the revealer takes the alignment. */
  panel: Gtk.Widget
  /**
   * Bar edge the panel belongs to, which is the edge it slides from. A centred
   * panel belongs to no edge and can leave it out.
   */
  position?: BarPosition
  halign?: Gtk.Align
  valign?: Gtk.Align
  /**
   * Centre the panel on screen instead of hanging it off the bar.
   *
   * A centred panel belongs to no edge, so it has none to slide out of and
   * fades in instead.
   */
  centered?: boolean
  /**
   * Stretch the panel over the whole height of the surface, which is the
   * screen minus the bar. A side panel rather than a dropdown.
   */
  tall?: boolean
}

/** The widget to put in the window, wrapping `panel`. */
export function revealPanel({
  window,
  panel,
  position = "top",
  halign = Gtk.Align.CENTER,
  valign = Gtk.Align.START,
  centered = false,
  tall = false,
}: RevealPanelProps): Gtk.Widget {
  const duration = animationDuration()

  const revealer = new Gtk.Revealer({
    child: panel,
    transitionType: centered ? fade() : slideFrom(position),
    transitionDuration: duration,
    revealChild: false,
    halign: centered ? Gtk.Align.CENTER : halign,
    // A tall panel fills the surface top to bottom, so nothing is left for an
    // alignment to decide.
    valign: centered ? Gtk.Align.CENTER : tall ? Gtk.Align.FILL : valign,
    // Expanding is what gives the alignment room to work: a widget only
    // centres itself inside space it was given more of than it asked for.
    hexpand: centered,
    vexpand: centered || tall,
  })

  let open = false
  let closeTimer: number | null = null

  function cancelClose(): void {
    if (closeTimer === null) return
    GLib.source_remove(closeTimer)
    closeTimer = null
  }

  function setVisible(visible: boolean): void {
    if (visible === open) return
    open = visible
    cancelClose()

    if (visible) {
      window.visible = true
      panel.add_css_class("revealed")

      if (duration === 0) {
        revealer.reveal_child = true
        return
      }

      // One turn of the loop before revealing: a revealer told to slide in the
      // same frame its window is mapped has no start state to slide from, and
      // the panel simply appears.
      GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        if (open) revealer.reveal_child = true
        return GLib.SOURCE_REMOVE
      })
      return
    }

    revealer.reveal_child = false
    panel.remove_css_class("revealed")

    if (duration === 0) {
      window.visible = false
      return
    }

    // Unmap once the slide has finished, not before, or it is cut off.
    closeTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, duration, () => {
      closeTimer = null
      if (!open) window.visible = false
      return GLib.SOURCE_REMOVE
    })
  }

  registerVisibility(window, { set: setVisible, isOpen: () => open })
  window.connect("destroy", cancelClose)

  // A centred panel needs no packing help: it fills the surface and puts
  // itself in the middle of it. Neither does a tall one under a horizontal
  // bar: it already occupies the whole height, and a filler beside it would
  // only fight it for the space.
  if (centered || (tall && !isVertical(position))) return revealer

  // A box packs its children from its start, so a child's alignment along the
  // box's own axis is ignored -- which is why `valign: END` alone left every
  // dropdown at the top of the screen with the bar at the bottom. The panel is
  // pushed to the far edge with an expanding filler instead; alignment across
  // the box's axis still comes from the revealer itself.
  const wrapper = new Gtk.Box({
    orientation: isVertical(position) ? Gtk.Orientation.HORIZONTAL : Gtk.Orientation.VERTICAL,
    hexpand: true,
    vexpand: true,
  })

  const filler = new Gtk.Box({ hexpand: true, vexpand: true })

  if (position === "bottom" || position === "right") {
    wrapper.append(filler)
    wrapper.append(revealer)
  } else {
    wrapper.append(revealer)
    wrapper.append(filler)
  }

  return wrapper
}
