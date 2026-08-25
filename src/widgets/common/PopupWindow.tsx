import Gdk from "gi://Gdk?version=4.0"
import { Astal, Gtk } from "ags/gtk4"
import app from "ags/gtk4/app"

import { config } from "../../config"
import { popupAlignment, positionClass, type PopupAlign } from "../../lib/barLayout"
import { revealPanel } from "./revealPanel"
import { setWindowVisible } from "./popupVisibility"

/**
 * A dismissible panel that drops out of the bar.
 *
 * GNOME drops its calendar from the centre of the panel and its quick settings
 * from the top right, so each popup is its own layer-shell surface anchored to
 * all four edges with the panel aligned inside it. Three things fall out of
 * that:
 *
 *   - `Exclusivity.NORMAL` makes the surface respect the bar's exclusive zone,
 *     so its area already begins beside the bar and the panel needs no
 *     hand-computed offset -- which is what lets the same code serve a bar on
 *     any of the four edges;
 *   - the leftover area doubles as the click-outside target, which is how the
 *     popup gets dismissed without a pointer grab;
 *   - the panel slides inside a surface that is already mapped, so opening it
 *     animates without the compositor resizing anything (see `revealPanel`).
 *
 * `Keymode.ON_DEMAND` lets the surface take keyboard focus when the user
 * interacts with it -- needed for Escape -- without stealing focus while it is
 * merely open.
 */

export interface PopupWindowProps {
  /** Window name, used by `app.toggle_window` and the IPC handler. */
  name: string
  /** Placement along the bar's own axis, from the opening module's section. */
  align: PopupAlign
  /** Panel contents. */
  child: Gtk.Widget
  /** Extra style classes for the panel itself. */
  cssClasses?: string[]
  /**
   * Stretch the panel over the full height of the screen beside the bar,
   * instead of hanging from it at the height of its contents.
   */
  tall?: boolean
  /**
   * Take the keyboard while open, so the panel can be driven without the
   * mouse. Off by default: a dropdown that steals every key from the window
   * underneath is only worth it where there is something to navigate.
   */
  keyboard?: boolean
  /**
   * First go at Escape. Returning true keeps the panel open -- used where
   * Escape means "back to the previous page" rather than "close".
   */
  onEscape?: () => boolean
}

export function PopupWindow({
  name,
  align,
  child,
  cssClasses = [],
  tall = false,
  keyboard = false,
  onEscape,
}: PopupWindowProps): Astal.Window {
  const position = config.get().bar.position
  const { halign, valign } = popupAlignment(position, align)

  const panel = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    cssClasses: [
      "manifold-panel",
      "manifold-root",
      "manifold-popup",
      positionClass(position),
      ...(tall ? ["manifold-popup-tall"] : []),
      ...cssClasses,
    ],
  })
  panel.append(child)

  // Fills the whole surface; every click that misses `panel` lands here.
  const root = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    cssClasses: ["manifold-popup-backdrop"],
    hexpand: true,
    vexpand: true,
  })

  const window = (
    <window
      name={name}
      namespace={`manifold-${name}`}
      cssClasses={["manifold-window", "manifold-popup-window"]}
      application={app}
      anchor={
        Astal.WindowAnchor.TOP |
        Astal.WindowAnchor.BOTTOM |
        Astal.WindowAnchor.LEFT |
        Astal.WindowAnchor.RIGHT
      }
      exclusivity={Astal.Exclusivity.NORMAL}
      layer={Astal.Layer.TOP}
      keymode={keyboard ? Astal.Keymode.EXCLUSIVE : Astal.Keymode.ON_DEMAND}
      visible={false}
    >
      {root}
    </window>
  ) as Astal.Window

  // Filled in after the window exists: the revealer takes over its visibility.
  root.append(revealPanel({ window, panel, position, halign, valign, tall }))

  // -- dismiss on click outside the panel ---------------------------------
  const click = new Gtk.GestureClick({ button: 0 })
  click.connect("pressed", (_gesture, _n: number, x: number, y: number) => {
    const [ok, bounds] = panel.compute_bounds(root)
    if (!ok) return

    const inside =
      x >= bounds.origin.x &&
      x <= bounds.origin.x + bounds.size.width &&
      y >= bounds.origin.y &&
      y <= bounds.origin.y + bounds.size.height

    if (!inside) setWindowVisible(window, false)
  })
  root.add_controller(click)

  // -- dismiss on Escape --------------------------------------------------
  const keys = new Gtk.EventControllerKey()
  keys.connect("key-pressed", (_controller, keyval: number) => {
    if (keyval !== Gdk.KEY_Escape) return false
    if (onEscape?.()) return true

    setWindowVisible(window, false)
    return true
  })
  window.add_controller(keys)

  return window
}
