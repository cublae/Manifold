import GLib from "gi://GLib"
import { Gtk } from "ags/gtk4"
import { createPoll } from "ags/time"

import { config, type BarPosition } from "../../../config"
import { isVertical } from "../../../lib/barLayout"
import { WindowName, togglePopup } from "../../names"

/**
 * The clock ticks once a second and reads its format from the live config on
 * every tick, so editing `clock.format` takes effect without a restart.
 *
 * The poll is module-scoped: one timer serves every monitor's bar.
 */
const now = createPoll(GLib.DateTime.new_now_local(), 1000, () =>
  GLib.DateTime.new_now_local(),
)

function format(time: GLib.DateTime, pattern: string): string {
  return time.format(pattern) ?? ""
}

export default function Clock({ position }: { position: BarPosition }): Gtk.Widget {
  // A vertical bar is far too narrow for "23:47", so it gets its own format --
  // by default hours stacked over minutes, which is what vertical panels
  // everywhere settle on. GTK4 dropped Gtk.Label's rotation, so turning the
  // text sideways is not an option.
  const vertical = isVertical(position)

  return (
    <button
      cssClasses={["manifold-module", "manifold-clock"]}
      tooltipText={now((time) => format(time, config.get().clock.tooltipFormat))}
      onClicked={() => togglePopup(WindowName.Calendar)}
    >
      <label
        justify={Gtk.Justification.CENTER}
        label={now((time) => {
          const cfg = config.get().clock
          return format(time, vertical ? cfg.verticalFormat : cfg.format)
        })}
      />
    </button>
  ) as Gtk.Widget
}
