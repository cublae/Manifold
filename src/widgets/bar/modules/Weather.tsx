import GLib from "gi://GLib"
import { Gtk } from "ags/gtk4"
import { createBinding, createComputed } from "ags"

import WeatherService from "../../../services/weather"
import { config } from "../../../config"
import { WindowName, togglePopup } from "../../names"
import type { BarPosition } from "../../../config"

/**
 * Temperature and condition in the bar; the rest in a dropdown.
 *
 * Hidden entirely until `weather.latitude`/`longitude` are set. There is no
 * sensible default for those -- guessing from the IP address would hand it to a
 * geolocation service before the user agreed to anything -- so an unconfigured
 * module shows nothing rather than the wrong city.
 */

export interface WeatherProps {
  position: BarPosition
}

/** Whole degrees. Tenths in a panel are noise. */
function degrees(value: number): string {
  return `${Math.round(value)}°`
}

export default function Weather({ position }: WeatherProps): Gtk.Widget {
  const { latitude, longitude, location } = config.get().weather
  const configured = latitude !== 0 || longitude !== 0 || location.trim() !== ""

  // Not merely hidden: without coordinates the service would poll a point in
  // the Atlantic every half hour.
  if (!configured) return new Gtk.Box({ visible: false })

  const weather = WeatherService.get_default()
  const now = createBinding(weather, "now")
  const error = createBinding(weather, "error")
  const place = createBinding(weather, "place")

  const vertical = position === "left" || position === "right"

  return (
    <button
      cssClasses={["manifold-module", "manifold-weather"]}
      valign={Gtk.Align.CENTER}
      // Until the first fetch lands there is nothing to show, and a module that
      // appears a second after the bar is better than one that shows a dash.
      visible={now((reading) => reading !== null)}
      tooltipText={createComputed([now, error, place], (reading, failure, where) => {
        if (failure) return `Weather unavailable: ${failure}`
        if (!reading) return ""

        // The place goes first, because the one thing a temperature on its own
        // cannot tell you is whether it is *your* temperature.
        const head = where?.name ? `${where.name}\n` : ""
        return (
          `${head}${reading.label}, feels like ${degrees(reading.apparent)}\n` +
          `Humidity ${Math.round(reading.humidity)}%`
        )
      })}
      onClicked={() => togglePopup(WindowName.Weather)}
    >
      <box spacing={6} orientation={vertical ? Gtk.Orientation.VERTICAL : Gtk.Orientation.HORIZONTAL}>
        <image iconName={now((reading) => reading?.icon ?? "")} />
        <label label={now((reading) => (reading ? degrees(reading.temperature) : ""))} />
      </box>
    </button>
  ) as Gtk.Widget
}

/** Weekday name for an ISO date, e.g. `Tue`. */
export function dayName(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number)
  const date = GLib.DateTime.new_local(year ?? 1970, month ?? 1, day ?? 1, 12, 0, 0)
  return date?.format("%a") ?? iso
}
