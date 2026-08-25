import { Gtk } from "ags/gtk4"
import { createState } from "ags"

import * as system from "../../../services/system"
import { bellIcon } from "../../../lib/icons"
import { WindowName, togglePopup } from "../../names"

/**
 * Bell icon with an unread marker, opening the notification centre.
 *
 * The marker is a dot rather than a count: the exact number is one click away
 * in the centre itself, and a dot keeps the bar's width from shifting as
 * notifications arrive. The tooltip still carries the number.
 *
 * "Unread" here means what the daemon is still holding: notifications the user
 * has neither dismissed nor acted on.
 */
export default function Notifications(): Gtk.Widget {
  const [count, setCount] = createState(0)
  const [dnd, setDnd] = createState(false)

  const icon = (<image iconName={dnd((quiet) => bellIcon(quiet))} />) as Gtk.Widget

  const dot = (
    <box
      cssClasses={["manifold-notification-dot"]}
      halign={Gtk.Align.END}
      valign={Gtk.Align.START}
      visible={count((n) => n > 0)}
    />
  ) as Gtk.Widget

  // An overlay takes its size from the main child alone, so the dot sits on the
  // bell's corner without making the button any bigger.
  const stack = new Gtk.Overlay({ child: icon })
  stack.add_overlay(dot)

  // Built as JSX rather than with the plain constructor: the tooltip is bound
  // to the count, and only the JSX path understands an accessor.
  const button = (
    <button
      cssClasses={["manifold-module", "manifold-notifications-button"]}
      tooltipText={count((n) =>
        n > 0 ? `${n} notification${n === 1 ? "" : "s"}` : "Notifications",
      )}
      valign={Gtk.Align.CENTER}
      onClicked={() => togglePopup(WindowName.NotificationCenter)}
    >
      {stack}
    </button>
  ) as Gtk.Widget

  void (async () => {
    const notifd = await system.notifd()
    if (!notifd) return

    const sync = () => {
      setCount(notifd.notifications.length)
      setDnd(notifd.dontDisturb)
    }

    notifd.connect("notified", sync)
    notifd.connect("resolved", sync)
    notifd.connect("notify::dont-disturb", sync)
    sync()
  })()

  return button
}
