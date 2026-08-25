import { Gtk } from "ags/gtk4"
import { createBinding } from "ags"

import type AstalTrayNS from "gi://AstalTray"
import * as system from "../../../services/system"
import { captureScope } from "../../../lib/scope"
import { moduleOrientation } from "../../../lib/barLayout"
import type { BarPosition } from "../../../config"

/**
 * System tray (StatusNotifierItem).
 *
 * Items appear and disappear as applications come and go, and the Tray object
 * signals that with `item-added`/`item-removed` rather than by notifying an
 * `items` property -- so the list is rebuilt from those signals.
 *
 * Input follows the StatusNotifierItem spec rather than GTK habit:
 *
 *   - left click runs the item's primary action, which is usually "show the
 *     window", not "open a menu";
 *   - right click opens the context menu;
 *   - middle click runs the secondary action;
 *   - scrolling is forwarded, which is how volume applets expect to be used.
 *
 * Items that set `ItemIsMenu` have no primary action at all, and for those a
 * left click opens the menu instead -- otherwise clicking them would do
 * nothing.
 */

const ACTION_GROUP = "dbusmenu"

/** Which way the menu should open, given where the bar sits. */
function menuPosition(position: BarPosition): Gtk.PositionType {
  switch (position) {
    case "bottom":
      return Gtk.PositionType.TOP
    case "left":
      return Gtk.PositionType.RIGHT
    case "right":
      return Gtk.PositionType.LEFT
    default:
      return Gtk.PositionType.BOTTOM
  }
}

function TrayItem(item: AstalTrayNS.TrayItem, position: BarPosition): Gtk.Widget {
  const button = new Gtk.Button({ cssClasses: ["manifold-tray-item"] })
  button.set_child((<image gicon={createBinding(item, "gicon")} />) as Gtk.Widget)

  // The menu is a popover parented to the button rather than a MenuButton's
  // own, so that opening it is something this code decides rather than a side
  // effect of the button being pressed.
  let popover: Gtk.PopoverMenu | null = null

  const applyMenu = () => {
    popover?.unparent()
    popover = null

    const model = item.menuModel
    if (!model) return

    popover = Gtk.PopoverMenu.new_from_model(model)
    popover.set_parent(button)
    popover.set_has_arrow(false)
    // Open away from the screen edge the bar is on, or the menu lands
    // half off-screen on a bottom or side bar.
    popover.set_position(menuPosition(position))
    button.insert_action_group(ACTION_GROUP, item.actionGroup)
  }
  applyMenu()

  const openMenu = () => {
    if (!popover) return false
    // Lets the application refresh its menu before it is shown, which is what
    // dbusmenu clients expect and what keeps stale entries out.
    item.about_to_show()
    popover.popup()
    return true
  }

  button.connect("clicked", () => {
    // `is_menu` means the item offers nothing but its menu.
    if (item.isMenu) {
      openMenu()
      return
    }
    item.activate(0, 0)
  })

  const secondary = new Gtk.GestureClick({ button: 3 })
  secondary.connect("pressed", () => openMenu())
  button.add_controller(secondary)

  const middle = new Gtk.GestureClick({ button: 2 })
  middle.connect("pressed", () => item.secondary_activate(0, 0))
  button.add_controller(middle)

  const scroll = new Gtk.EventControllerScroll({
    flags: Gtk.EventControllerScrollFlags.BOTH_AXES,
  })
  scroll.connect("scroll", (_source, dx: number, dy: number) => {
    if (dy !== 0) item.scroll(Math.round(dy), "vertical")
    if (dx !== 0) item.scroll(Math.round(dx), "horizontal")
    return true
  })
  button.add_controller(scroll)

  const tooltip = () => button.set_tooltip_markup(item.tooltipMarkup || item.title || "")
  tooltip()

  const handlers = [
    item.connect("notify::menu-model", applyMenu),
    item.connect("notify::action-group", applyMenu),
    item.connect("notify::tooltip-markup", tooltip),
    item.connect("notify::title", tooltip),
  ]

  button.connect("destroy", () => {
    for (const id of handlers) item.disconnect(id)
    // A popover outlives its parent unless unparented, and GTK complains.
    popover?.unparent()
    popover = null
  })

  return button
}

export default function Tray({ position }: { position: BarPosition }): Gtk.Widget {
  const inScope = captureScope()

  const box = new Gtk.Box({
    orientation: moduleOrientation(position),
    spacing: 2,
    cssClasses: ["manifold-module", "manifold-tray"],
  })

  void (async () => {
    const tray = await system.tray()
    if (!tray) return

    const widgets = new Map<string, Gtk.Widget>()

    const add = (item: AstalTrayNS.TrayItem) => {
      if (widgets.has(item.itemId)) return
      const widget = inScope(() => TrayItem(item, position))
      widgets.set(item.itemId, widget)
      box.append(widget)
      box.set_visible(true)
    }

    const remove = (itemId: string) => {
      const widget = widgets.get(itemId)
      if (!widget) return
      box.remove(widget)
      widgets.delete(itemId)
      // Collapse the module rather than leaving an empty gap in the bar.
      box.set_visible(widgets.size > 0)
    }

    for (const item of tray.get_items()) add(item)
    box.set_visible(widgets.size > 0)

    const added = tray.connect("item-added", (_tray, itemId: string) => {
      const item = tray.get_item(itemId)
      if (item) add(item)
    })
    const removed = tray.connect("item-removed", (_tray, itemId: string) => remove(itemId))

    box.connect("destroy", () => {
      tray.disconnect(added)
      tray.disconnect(removed)
    })
  })()

  return box
}
