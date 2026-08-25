import { Astal, Gtk } from "ags/gtk4"

import type { BarPosition } from "../config"

/**
 * Bar geometry.
 *
 * Every decision that follows from where the bar sits lives here, so modules
 * ask "am I vertical?" instead of each deriving it from the position enum.
 *
 * The mental model is a main axis and a cross axis. The bar runs along its main
 * axis (horizontal for top/bottom, vertical for left/right) and is anchored to
 * the screen edge on its cross axis. Dropdowns invert that: they are pinned to
 * the bar's edge on the cross axis and positioned along the main axis by
 * whichever module opened them.
 */

export function isVertical(position: BarPosition): boolean {
  return position === "left" || position === "right"
}

/** Screen edges the bar clings to: its own edge plus both ends of its axis. */
export function barAnchor(position: BarPosition): Astal.WindowAnchor {
  const { TOP, BOTTOM, LEFT, RIGHT } = Astal.WindowAnchor

  switch (position) {
    case "bottom":
      return BOTTOM | LEFT | RIGHT
    case "left":
      return LEFT | TOP | BOTTOM
    case "right":
      return RIGHT | TOP | BOTTOM
    default:
      return TOP | LEFT | RIGHT
  }
}

/** Orientation of the bar's own layout. */
export function barOrientation(position: BarPosition): Gtk.Orientation {
  return isVertical(position) ? Gtk.Orientation.VERTICAL : Gtk.Orientation.HORIZONTAL
}

/** Orientation of a module's internal layout, which follows the bar. */
export function moduleOrientation(position: BarPosition): Gtk.Orientation {
  return barOrientation(position)
}

/** Where a dropdown sits along the bar, from the point of view of its module. */
export type PopupAlign = "start" | "center" | "end"

const ALIGN: Record<PopupAlign, Gtk.Align> = {
  start: Gtk.Align.START,
  center: Gtk.Align.CENTER,
  end: Gtk.Align.END,
}

/**
 * Alignment for a dropdown opened from a bar module.
 *
 * `along` positions the panel on the bar's main axis -- a clock in the centre
 * section wants its calendar centred there. The cross axis is fixed by the bar:
 * a top bar drops its panels down, a bottom bar raises them, a left bar pushes
 * them right.
 */
export function popupAlignment(
  position: BarPosition,
  along: PopupAlign,
): { halign: Gtk.Align; valign: Gtk.Align } {
  const main = ALIGN[along]

  switch (position) {
    case "bottom":
      return { halign: main, valign: Gtk.Align.END }
    case "left":
      return { halign: Gtk.Align.START, valign: main }
    case "right":
      return { halign: Gtk.Align.END, valign: main }
    default:
      return { halign: main, valign: Gtk.Align.START }
  }
}

/** Style class marking the bar's position, for CSS that needs to differ. */
export function positionClass(position: BarPosition): string {
  return `position-${position}`
}

/** Corner a notification popup stack is pinned to. */
export type NotificationCorner =
  | "top-left"
  | "top-center"
  | "top-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right"

/**
 * Where notification popups belong.
 *
 * Left to itself the stack follows the bar, because that is where the user is
 * already looking: a bar along the bottom raises its popups from the bottom.
 * A vertical bar gives no vertical edge to follow, so the popups stay at the
 * top and take the side away from it.
 */
export function notificationCorner(
  bar: BarPosition,
  configured: NotificationCorner | "auto",
): NotificationCorner {
  if (configured !== "auto") return configured

  switch (bar) {
    case "bottom":
      return "bottom-right"
    case "left":
      return "top-right"
    case "right":
      return "top-left"
    default:
      return "top-right"
  }
}
