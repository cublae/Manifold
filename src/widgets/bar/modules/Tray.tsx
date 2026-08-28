import { Gtk } from "ags/gtk4"
import { createBinding, createComputed, createState } from "ags"

import type Gio from "gi://Gio"
import type AstalTrayNS from "gi://AstalTray"
import * as system from "../../../services/system"
import { captureScope } from "../../../lib/scope"
import { FallbackItem } from "../../../services/trayFallback"
import type { DBusMenu } from "../../../services/dbusMenu"
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
  // Astal's icon when it has one, ours when it does not: an item whose proxy
  // landed on a path that answers nothing arrives with a null gicon and stays
  // that way, so the only icon it will ever have is the one read directly.
  const [rescued, setRescued] = createState<Gio.Icon | null>(null)
  const icon = createComputed(
    [createBinding(item, "gicon"), rescued],
    (fromAstal, fromUs) => fromAstal ?? fromUs,
  )
  button.set_child((<image gicon={icon} />) as Gtk.Widget)

  // Kept so the click handlers can reach the item the same way Astal's would,
  // and so the signal subscription can be dropped along with the button.
  let fallback: FallbackItem | null = null
  let rescuedMenu: DBusMenu | null = null
  let unsubscribe: (() => void) | null = null

  // The menu is a popover parented to the button rather than a MenuButton's
  // own, so that opening it is something this code decides rather than a side
  // effect of the button being pressed.
  let popover: Gtk.PopoverMenu | null = null

  const attachMenu = (model: Gio.MenuModel | null, actions: Gio.ActionGroup | null) => {
    popover?.unparent()
    popover = null

    if (!model) return

    popover = Gtk.PopoverMenu.new_from_model(model)
    popover.set_parent(button)
    popover.set_has_arrow(false)
    // Open away from the screen edge the bar is on, or the menu lands
    // half off-screen on a bottom or side bar.
    popover.set_position(menuPosition(position))
    button.insert_action_group(ACTION_GROUP, actions)
  }

  const applyMenu = () => attachMenu(item.menuModel, item.actionGroup)
  applyMenu()

  const openMenu = () => {
    // A rescued item always goes the other way, even once it has a popover:
    // that popover is one we built, and refreshing it means asking the
    // application again rather than notifying a proxy that answers nothing.
    if (fallback || !popover) return false
    // Lets the application refresh its menu before it is shown, which is what
    // dbusmenu clients expect and what keeps stale entries out.
    item.about_to_show()
    popover.popup()
    return true
  }

  /**
   * The same, for an item we had to read ourselves.
   *
   * Built on every opening rather than kept around: the application is asked
   * to refresh the menu first, and rebuilding a popover that is already on
   * screen would only close it.
   */
  const openRescuedMenu = async () => {
    if (!fallback) return

    rescuedMenu ??= await fallback.menu()
    if (!rescuedMenu) {
      // Nothing to build from, so the last resort is asking the application to
      // put up its own menu -- which is a poor one, but better than nothing.
      fallback.contextMenu(0, 0)
      return
    }

    await rescuedMenu.aboutToShow()
    attachMenu(rescuedMenu.model(), rescuedMenu.actionGroup)
    popover?.popup()
  }

  button.connect("clicked", () => {
    // `is_menu` means the item offers nothing but its menu.
    if (item.isMenu) {
      openMenu()
      return
    }
    // The live proxy first: a rescued item is the exception, not the rule.
    if (item.id) item.activate(0, 0)
    else fallback?.activate(0, 0)
  })

  const secondary = new Gtk.GestureClick({ button: 3 })
  secondary.connect("pressed", () => {
    if (openMenu()) return
    void openRescuedMenu().catch((error) =>
      console.error(`manifold: tray menu unread: ${error}`),
    )
  })
  button.add_controller(secondary)

  const middle = new Gtk.GestureClick({ button: 2 })
  middle.connect("pressed", () => {
    if (item.id) item.secondary_activate(0, 0)
    else fallback?.secondaryActivate(0, 0)
  })
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

  // A registered item is not always a drawable one, and the button follows
  // whether there is anything to draw -- from either source. It is reactive
  // rather than a test at construction time because registering first and
  // filling in properties a moment later is normal behaviour.
  const followIcon = () => button.set_visible(item.gicon !== null || rescued.get() !== null)
  followIcon()

  /**
   * Read the item ourselves when Astal could not.
   *
   * Only for items that arrive with nothing at all: a null gicon here means
   * the proxy is answering from a path that holds no object, and waiting for
   * it to fill in would be waiting forever.
   */
  const rescue = async () => {
    // Not merely slow: an item that is only late still has its id, and will
    // notify when its icon arrives. This one has nothing and never will.
    if (item.gicon !== null || item.id || fallback !== null) return

    const found = await FallbackItem.locate(item.itemId)
    if (!found) return
    fallback = found

    const refresh = async () => {
      setRescued(await found.icon())
      followIcon()
      const label = await found.label()
      if (label) button.set_tooltip_markup(label)
    }

    unsubscribe = found.subscribe(() => void refresh())
    await refresh()
  }

  void rescue().catch((error) => console.error(`manifold: tray item unread: ${error}`))

  const handlers = [
    item.connect("notify::menu-model", applyMenu),
    item.connect("notify::action-group", applyMenu),
    item.connect("notify::tooltip-markup", tooltip),
    item.connect("notify::title", tooltip),
    item.connect("notify::gicon", followIcon),
  ]

  button.connect("destroy", () => {
    for (const id of handlers) item.disconnect(id)
    unsubscribe?.()
    unsubscribe = null
    fallback = null
    rescuedMenu = null
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
