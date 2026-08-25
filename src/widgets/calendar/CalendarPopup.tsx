import GLib from "gi://GLib"
import { Astal, Gtk } from "ags/gtk4"
import { createPoll } from "ags/time"

import { config } from "../../config"
import { PopupWindow } from "../common/PopupWindow"
import { WindowName } from "../names"
import Calendar from "./Calendar"

/**
 * The calendar that drops from the clock, GNOME-style.
 *
 * Just the month grid under today's date. The same grid also sits at the top of
 * the notification centre, which is the fuller version of this panel.
 */

/** Refreshes once a minute so the heading is right after midnight. */
const today = createPoll(GLib.DateTime.new_now_local(), 60_000, () =>
  GLib.DateTime.new_now_local(),
)

export default function CalendarPopup(): Astal.Window {
  const heading = (
    <label
      cssClasses={["manifold-calendar-heading"]}
      halign={Gtk.Align.START}
      label={today((time) => time.format(config.get().clock.tooltipFormat) ?? "")}
    />
  ) as Gtk.Widget

  const content = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 8,
    cssClasses: ["manifold-popup-content", "manifold-calendar-content"],
  })
  content.append(heading)
  content.append(Calendar())

  return PopupWindow({
    name: WindowName.Calendar,
    align: "center",
    cssClasses: ["manifold-calendar-popup"],
    child: content,
  })
}
