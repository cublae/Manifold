import { Astal, Gtk } from "ags/gtk4"
import { For, createBinding, createComputed } from "ags"
import { _ } from "../../lib/i18n"

import WeatherService, { type Day } from "../../services/weather"
import { config } from "../../config"
import { captureScope } from "../../lib/scope"
import { PopupWindow } from "../common/PopupWindow"
import { WindowName } from "../names"
import { dayName } from "../bar/modules/Weather"

/**
 * The forecast, dropped from the weather module.
 *
 * Today at the top in full, the next few days as one row each. Nothing here is
 * hourly: a bar dropdown is a glance, and an hourly chart is a weather
 * application.
 */

function degrees(value: number): string {
  return `${Math.round(value)}°`
}

/** `13 km/h` or `8 mph`, matching whatever the service was asked for. */
function wind(speed: number): string {
  const unit = config.get().weather.units === "imperial" ? "mph" : "km/h"
  return `${Math.round(speed)} ${unit}`
}

export default function WeatherPopup(): Astal.Window {
  const inScope = captureScope()
  const weather = WeatherService.get_default()

  const now = createBinding(weather, "now")
  const forecast = createBinding(weather, "forecast")
  const error = createBinding(weather, "error")
  const place = createBinding(weather, "place")

  // Above the reading rather than beside it: the panel is a column, and the
  // place is the heading for everything under it.
  const where = inScope(
    () =>
      (
        <label
          cssClasses={["manifold-weather-place"]}
          // `hexpand` with `xalign`, not `halign: START`: an ellipsizing label
          // asks for almost no width, and a box hands a START-aligned child
          // exactly what it asked for -- so the name is cut to a few letters
          // in a panel with room to spare.
          hexpand
          xalign={0}
          ellipsize={3}
          visible={place((p) => Boolean(p?.name))}
          label={place((p) => p?.name ?? "")}
        />
      ) as Gtk.Widget,
  )

  const today = inScope(
    () =>
      (
        <box cssClasses={["manifold-weather-today"]} spacing={12} visible={now((n) => n !== null)}>
          <image iconName={now((n) => n?.icon ?? "")} pixelSize={48} />
          <box orientation={Gtk.Orientation.VERTICAL} hexpand valign={Gtk.Align.CENTER}>
            <label
              cssClasses={["temperature"]}
              halign={Gtk.Align.START}
              label={now((n) => (n ? degrees(n.temperature) : ""))}
            />
            <label
              cssClasses={["label"]}
              halign={Gtk.Align.START}
              label={now((n) => n?.label ?? "")}
            />
            <label
              cssClasses={["detail", "dim"]}
              halign={Gtk.Align.START}
              label={now((n) =>
                n ? `Feels like ${degrees(n.apparent)} · ${Math.round(n.humidity)}% · ${wind(n.wind)}` : "",
              )}
            />
          </box>
        </box>
      ) as Gtk.Widget,
  )

  // Today already has its own block above, so the list starts at tomorrow.
  const rest = createComputed([forecast], (days) => days.slice(1))

  const days = inScope(
    () =>
      (
        <box orientation={Gtk.Orientation.VERTICAL} spacing={2} cssClasses={["manifold-weather-days"]}>
          <For each={rest} id={(day: Day) => day.date}>
            {(day: Day) => (
              <box cssClasses={["manifold-weather-day"]} spacing={10}>
                {/*
                  The row index is not used: `For` hands it over as an
                  `Accessor`, not a number, and every row here is a day after
                  today anyway -- the "Today" case belongs to the block above.
                */}
                <label
                  cssClasses={["day"]}
                  halign={Gtk.Align.START}
                  widthChars={4}
                  label={dayName(day.date)}
                />
                <image iconName={day.icon} />
                <label cssClasses={["dim"]} hexpand halign={Gtk.Align.START} label={day.label} />
                <label cssClasses={["low", "dim"]} label={degrees(day.low)} />
                <label cssClasses={["high"]} label={degrees(day.high)} />
              </box>
            )}
          </For>
        </box>
      ) as Gtk.Widget,
  )

  // Shown in place of everything else, so the panel is never an empty box.
  const failed = inScope(
    () =>
      (
        <box
          orientation={Gtk.Orientation.VERTICAL}
          spacing={6}
          cssClasses={["manifold-weather-error", "dim"]}
          valign={Gtk.Align.CENTER}
          vexpand
          visible={createComputed([now, error], (reading, failure) => reading === null && failure !== null)}
        >
          <image iconName="network-offline-symbolic" pixelSize={32} />
          <label label={_("No weather right now")} />
        </box>
      ) as Gtk.Widget,
  )

  const content = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 8,
    cssClasses: ["manifold-popup-content", "manifold-weather-popup"],
  })
  content.append(where)
  content.append(today)
  content.append(days)
  content.append(failed)

  return PopupWindow({
    name: WindowName.Weather,
    align: "end",
    child: content,
  })
}
