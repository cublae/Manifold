import GLib from "gi://GLib"
import { Gtk } from "ags/gtk4"

/**
 * Keyboard focus helpers for panels that fill themselves in after they exist.
 *
 * Every panel in the shell is assembled as its services answer, and a stack
 * page only becomes focusable once it is the visible child, so a `grab_focus`
 * issued at the moment a panel opens usually lands on nothing at all. These
 * helpers wait for the widget to be on screen and then defer one more turn,
 * which is enough in both cases.
 */

/** Run `fn` on the next idle turn, once the widget tree has settled. */
function soon(fn: () => void): void {
  GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
    fn()
    return GLib.SOURCE_REMOVE
  })
}

/**
 * Run `fn` once `widget` is mapped, or right away if it already is.
 *
 * Panels open behind a revealer, which maps its child when the reveal starts
 * rather than when the window becomes visible -- so at the moment a popup is
 * told to show, everything inside it is still unmapped and refuses focus. The
 * extra idle turn after `map` is for GTK's own focus handling, which runs
 * during map and would otherwise overwrite ours with the first focusable
 * widget in the panel.
 */
function whenMapped(widget: Gtk.Widget, fn: () => void): void {
  if (widget.get_mapped()) {
    soon(fn)
    return
  }

  const id = widget.connect("map", () => {
    widget.disconnect(id)
    soon(fn)
  })
}

/**
 * Move focus to the first thing inside `container` that will take it.
 *
 * `child_focus` rather than a search of our own: it is the walk GTK does for
 * Tab, so it honours focusability, sensitivity and visibility without this file
 * having to know what any given panel is made of.
 */
function enter(container: Gtk.Widget): void {
  if (container.get_root() === null) return
  container.child_focus(Gtk.DirectionType.TAB_FORWARD)
}

export function focusFirst(container: Gtk.Widget): void {
  whenMapped(container, () => enter(container))
}

/**
 * Put focus back on the widget a page was opened from, or at the start of
 * `fallback` if it has gone away.
 *
 * Focus belongs on the control that opened the page, not back at the top of the
 * panel. It can still vanish while the page is open -- a Bluetooth tile whose
 * adapter was unplugged -- and a page opened with the mouse never had a focused
 * opener to begin with, which is what the fallback is for.
 */
export function focusAgain(widget: Gtk.Widget | null, fallback: Gtk.Widget): void {
  whenMapped(fallback, () => {
    if (widget !== null && widget.get_mapped()) widget.grab_focus()
    else enter(fallback)
  })
}
