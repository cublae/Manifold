import { Astal, Gtk } from "ags/gtk4"
import { createBinding } from "ags"
import type AstalNotifdNS from "gi://AstalNotifd"
import { _ } from "../../lib/i18n"

import * as system from "../../services/system"
import { bellIcon } from "../../lib/icons"
import { captureScope } from "../../lib/scope"
import { PopupWindow } from "../common/PopupWindow"
import { WindowName } from "../names"
import NotificationCard from "./NotificationCard"

/**
 * The notification centre: history plus the do-not-disturb switch.
 *
 * The list is rebuilt wholesale on every change. It is short by nature, a few
 * dozen entries at most, so tracking individual insertions would cost more in
 * complexity than it saves in work.
 */

export default function NotificationCenter(): Astal.Window {
  const inScope = captureScope()

  const list = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 8,
    cssClasses: ["manifold-notification-list"],
  })

  // The panel is the height of the screen, so an empty history centres its
  // notice in all that room rather than leaving it under the heading.
  const empty = (
    <box
      orientation={Gtk.Orientation.VERTICAL}
      spacing={8}
      cssClasses={["manifold-notification-empty", "dim"]}
      valign={Gtk.Align.CENTER}
      vexpand
    >
      <image iconName={bellIcon(true)} pixelSize={32} />
      <label label={_("No notifications")} />
    </box>
  ) as Gtk.Widget

  // Takes the rest of the panel and scrolls: there is no height to grow to
  // when the panel is already as tall as the screen.
  const scroller = new Gtk.ScrolledWindow({
    hscrollbarPolicy: Gtk.PolicyType.NEVER,
    vscrollbarPolicy: Gtk.PolicyType.AUTOMATIC,
    vexpand: true,
    child: list,
  })

  const header = new Gtk.Box({
    orientation: Gtk.Orientation.HORIZONTAL,
    spacing: 4,
    cssClasses: ["manifold-notification-header"],
  })
  header.append(
    (<label cssClasses={["title"]} halign={Gtk.Align.START} hexpand label={_("Notifications")} />) as Gtk.Widget,
  )

  const content = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 8,
    cssClasses: ["manifold-popup-content", "manifold-notification-center"],
  })
  content.append(header)
  content.append(empty)
  content.append(scroller)

  void (async () => {
    const notifd = await system.notifd()
    const urgency = await system.notifdUrgency()
    if (!notifd || !urgency) return

    // -- do not disturb ----------------------------------------------------
    const dnd = inScope(() => (
      <button
        cssClasses={createBinding(notifd, "dontDisturb").as((on) =>
          on ? ["manifold-notification-action", "active"] : ["manifold-notification-action"],
        )}
        tooltipText={_("Do not disturb")}
        onClicked={() => (notifd.dontDisturb = !notifd.dontDisturb)}
      >
        <image
          iconName={createBinding(notifd, "dontDisturb").as((on) =>
            bellIcon(on),
          )}
        />
      </button>
    ) as Gtk.Widget)

    const clear = inScope(() => (
      <button
        cssClasses={["manifold-notification-action", "destructive"]}
        tooltipText={_("Clear all")}
        onClicked={() => {
          for (const n of notifd.notifications) n.dismiss()
        }}
      >
        <image iconName="user-trash-symbolic" />
      </button>
    ) as Gtk.Widget)

    header.append(dnd)
    header.append(clear)

    // -- list --------------------------------------------------------------
    /**
     * Notifications grouped by the application that sent them.
     *
     * A chat or a build tool can put a dozen cards in a row, which pushes
     * everything else out of sight. Grouping keeps one card per application on
     * screen -- the newest -- with the rest folded behind a count that expands
     * in place.
     *
     * Groups are ordered by their newest member, so the panel still reads
     * newest first, and a single notification looks exactly as it did before:
     * no header, no disclosure, just the card.
     */
    const expanded = new Set<string>()

    const rebuild = () => {
      let child = list.get_first_child()
      while (child) {
        const next = child.get_next_sibling()
        list.remove(child)
        child = next
      }

      // Newest first, the way every notification centre orders its history.
      const notifications = [...notifd.notifications].sort((a, b) => b.time - a.time)

      const groups = new Map<string, AstalNotifdNS.Notification[]>()
      for (const n of notifications) {
        const key = n.appName || n.desktopEntry || "Notification"
        const group = groups.get(key)
        if (group) group.push(n)
        else groups.set(key, [n])
      }

      for (const [name, group] of groups) {
        if (group.length === 1) {
          list.append(inScope(() => NotificationCard({ notification: group[0], urgency })))
          continue
        }

        const open = expanded.has(name)
        const shown = open ? group : group.slice(0, 1)

        const box = new Gtk.Box({
          orientation: Gtk.Orientation.VERTICAL,
          spacing: 8,
          cssClasses: ["manifold-notification-group"],
        })

        box.append(
          inScope(() => (
            <box cssClasses={["header"]} spacing={6}>
              <label cssClasses={["app-name"]} halign={Gtk.Align.START} hexpand label={name} />
              <button
                cssClasses={["manifold-notification-action"]}
                tooltipText={open ? "Collapse" : `Show all ${group.length}`}
                onClicked={() => {
                  if (open) expanded.delete(name)
                  else expanded.add(name)
                  rebuild()
                }}
              >
                <box spacing={4}>
                  <label label={String(group.length)} />
                  <image
                    iconName={open ? "pan-up-symbolic" : "pan-down-symbolic"}
                    pixelSize={12}
                  />
                </box>
              </button>
              <button
                cssClasses={["manifold-notification-action", "destructive"]}
                tooltipText={`Dismiss all from ${name}`}
                onClicked={() => {
                  for (const n of group) n.dismiss()
                }}
              >
                <image iconName="user-trash-symbolic" pixelSize={12} />
              </button>
            </box>
          ) as Gtk.Widget),
        )

        for (const n of shown) {
          box.append(inScope(() => NotificationCard({ notification: n, urgency })))
        }

        list.append(box)
      }

      const any = notifications.length > 0
      empty.set_visible(!any)
      scroller.set_visible(any)
      clear.set_sensitive(any)
    }

    notifd.connect("notified", rebuild)
    notifd.connect("resolved", rebuild)
    rebuild()
  })()

  return PopupWindow({
    name: WindowName.NotificationCenter,
    align: "end",
    cssClasses: ["manifold-notification-center-popup"],
    tall: true,
    child: content,
  })
}
