import { Gtk } from "ags/gtk4"
import { createPoll } from "ags/time"

import { config } from "../../../config"
import { EMPTY, read, type Resources as Snapshot } from "../../../services/resources"

/**
 * CPU, memory and temperature.
 *
 * One timer feeds all three readings: they come from the same three files, and
 * splitting them would only mean reading `/proc` three times as often.
 *
 * Labelled with words rather than icons on purpose. Adwaita ships no icon for a
 * processor, a memory chip or a thermometer -- the names that exist are all
 * third-party -- so an icon here would be a missing-image square on a stock
 * system.
 */

function percent(value: number): string {
  return `${Math.round(value * 100)}%`
}

export default function Resources(): Gtk.Widget {
  const { interval, showCpu, showMemory, showTemperature } = config.get().resources
  const snapshot = createPoll<Snapshot>(EMPTY, Math.max(500, interval), () => read())

  const box = new Gtk.Box({
    orientation: Gtk.Orientation.HORIZONTAL,
    spacing: 8,
    cssClasses: ["manifold-module", "manifold-resources"],
    valign: Gtk.Align.CENTER,
  })

  const reading = (name: string, value: Gtk.Widget, tooltip: string): Gtk.Box => {
    const item = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 4 })
    item.append(new Gtk.Label({ label: name, cssClasses: ["name", "dim"] }))
    item.append(value)
    item.set_tooltip_text(tooltip)
    return item
  }

  if (showCpu) {
    box.append(
      reading("CPU", (<label label={snapshot((s) => percent(s.cpu))} />) as Gtk.Widget, "CPU load"),
    )
  }

  if (showMemory) {
    box.append(
      reading(
        "RAM",
        (<label label={snapshot((s) => percent(s.memory))} />) as Gtk.Widget,
        "Memory in use",
      ),
    )
  }

  if (showTemperature) {
    const item = reading(
      "TEMP",
      (<label label={snapshot((s) => `${s.temperature ?? 0}°`)} />) as Gtk.Widget,
      "CPU temperature",
    )

    // Hidden whole rather than showing a dash: on a machine where no sensor
    // answers, the reading is not "unknown", it simply does not exist.
    item.set_visible(snapshot.get().temperature !== null)
    const unsubscribe = snapshot.subscribe(() =>
      item.set_visible(snapshot.get().temperature !== null),
    )
    item.connect("destroy", () => unsubscribe())

    box.append(item)
  }

  return box
}
