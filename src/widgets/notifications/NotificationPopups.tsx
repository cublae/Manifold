import Gdk from "gi://Gdk?version=4.0"
import GLib from "gi://GLib"
import { Astal, Gtk } from "ags/gtk4"
import app from "ags/gtk4/app"
import { timeout } from "ags/time"
import type AstalIO from "gi://AstalIO"
import type AstalNotifdNS from "gi://AstalNotifd"

import * as system from "../../services/system"
import { captureScope } from "../../lib/scope"
import { config } from "../../config"
import { notificationCorner, type NotificationCorner } from "../../lib/barLayout"
import { animationDuration, slideFrom } from "../../lib/animation"
import NotificationCard from "./NotificationCard"

/**
 * Transient notification popups.
 *
 * A separate surface from the notification centre, and deliberately *not* a
 * dropdown: it must not close the calendar or steal clicks. It is anchored to
 * the bar's own edge -- popups arrive where the user is already looking -- with
 * `Exclusivity.NORMAL`, so the bar keeps its space. It stays click-through
 * everywhere except on the cards themselves, which is what
 * `Keymode.NONE` plus a zero-size window achieves -- the window only ever
 * occupies as much room as the visible cards.
 *
 * The daemon keeps notifications until they are dismissed; expiry here is
 * purely visual, so a popup timing out leaves the entry in the centre.
 */

interface Tracked {
  widget: Gtk.Revealer
  timer: AstalIO.Time | null
}

function anchorFor(corner: NotificationCorner): Astal.WindowAnchor {
  const edge = corner.startsWith("bottom") ? Astal.WindowAnchor.BOTTOM : Astal.WindowAnchor.TOP

  if (corner.endsWith("left")) return edge | Astal.WindowAnchor.LEFT
  if (corner.endsWith("center")) return edge
  return edge | Astal.WindowAnchor.RIGHT
}

export default function NotificationPopups(monitor: Gdk.Monitor): Astal.Window {
  const inScope = captureScope()

  const cfg = config.get()

  // Popups belong to the same edge as the bar unless the config says otherwise,
  // so they arrive where the user is already looking.
  const corner = notificationCorner(cfg.bar.position, cfg.notifications.position)
  const fromBottom = corner.startsWith("bottom")

  const list = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 8,
    cssClasses: ["manifold-notification-popups"],
    // Cards are appended, so stacking from the far edge keeps the newest one
    // nearest the edge the stack grows out of.
    valign: fromBottom ? Gtk.Align.END : Gtk.Align.START,
  })

  const window = (
    <window
      name="notification-popups"
      namespace="manifold-notifications"
      cssClasses={["manifold-window"]}
      application={app}
      gdkmonitor={monitor}
      anchor={anchorFor(corner)}
      // Respects the bar's exclusive zone so popups start below it, but
      // reserves no space of its own.
      exclusivity={Astal.Exclusivity.NORMAL}
      layer={Astal.Layer.TOP}
      keymode={Astal.Keymode.NONE}
      visible={false}
    >
      {list}
    </window>
  ) as Astal.Window

  const tracked = new Map<number, Tracked>()

  function syncVisibility(): void {
    // Driven by what is still on screen rather than by `tracked`: a card that
    // is sliding out has already left the map but is still visible.
    window.visible = list.get_first_child() !== null
  }

  function remove(id: number): void {
    const entry = tracked.get(id)
    if (!entry) return

    entry.timer?.cancel()
    tracked.delete(id)

    const duration = animationDuration()
    if (duration === 0) {
      list.remove(entry.widget)
      syncVisibility()
      return
    }

    // Slide out first, then take the row away, so the cards below it move up
    // rather than jumping.
    entry.widget.reveal_child = false
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, duration, () => {
      list.remove(entry.widget)
      syncVisibility()
      return GLib.SOURCE_REMOVE
    })
  }

  void (async () => {
    const notifd = await system.notifd()
    const urgency = await system.notifdUrgency()
    if (!notifd || !urgency) return

    const show = (n: AstalNotifdNS.Notification) => {
      const { timeout: seconds, maxPopups, doNotDisturb } = config.get().notifications
      if (doNotDisturb || notifd.dontDisturb) return

      // Oldest first, so the newest notification always gets a slot.
      while (tracked.size >= Math.max(1, maxPopups)) {
        const oldest = tracked.keys().next().value
        if (oldest === undefined) break
        remove(oldest)
      }

      // Each card gets its own revealer so it can slide in and out on its own
      // while its neighbours stay put.
      const card = inScope(() => NotificationCard({
        notification: n,
        urgency,
        compact: true,
        onDismiss: () => remove(n.id),
      }))

      const reveal = new Gtk.Revealer({
        child: card,
        // A card comes out of the edge its stack is pinned to.
        transitionType: slideFrom(fromBottom ? "bottom" : "top"),
        transitionDuration: animationDuration(),
        revealChild: false,
      })
      list.append(reveal)

      // Same reason as the dropdowns: reveal a frame later, or there is no
      // start state to slide from.
      GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        if (tracked.has(n.id)) reveal.reveal_child = true
        return GLib.SOURCE_REMOVE
      })

      // Critical notifications stay until the user deals with them, which is
      // what the freedesktop spec means by an expire timeout of zero.
      const expires = n.urgency !== urgency.CRITICAL
      tracked.set(n.id, {
        widget: reveal,
        timer: expires ? timeout(Math.max(1, seconds) * 1000, () => remove(n.id)) : null,
      })
      syncVisibility()
    }

    notifd.connect("notified", (_source, id: number) => {
      const n = notifd.get_notification(id)
      if (n) show(n)
    })

    // `resolved` fires when a notification is closed for any reason, including
    // the app withdrawing it, so the popup must follow.
    notifd.connect("resolved", (_source, id: number) => remove(id))
  })()

  return window
}
