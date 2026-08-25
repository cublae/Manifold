import GLib from "gi://GLib"
import GObject, { register, getter } from "ags/gobject"
import { interval } from "ags/time"
import type AstalIO from "gi://AstalIO"

import { config } from "../config"
import { getJson } from "../lib/http"
import { firstIcon } from "../lib/icons"
import { _ } from "../lib/i18n"

/**
 * Weather, from Open-Meteo.
 *
 * Chosen because it needs no API key. Every other free service wants one, which
 * would mean either shipping a key in a public repository or making the module
 * useless until the user goes and registers for one -- and a weather readout is
 * not worth an account.
 *
 * Conditions come back as WMO codes, the same numbering a METAR report uses.
 * They are grouped rather than translated one for one: the difference between
 * "slight" and "moderate" drizzle is not something an icon in a panel can show,
 * and nobody reads a bar module for it.
 */

/** A WMO code, described for a person. */
interface Condition {
  label: string
  /** Candidate icon names, most specific first; the theme decides. */
  icons: string[]
}

/**
 * WMO code ranges, coarsest first match wins.
 *
 * The icon names are the freedesktop weather set, which Adwaita and most themes
 * carry. `firstIcon` picks whichever exists, so a theme missing the specific
 * one still shows something rather than a broken square.
 */
function condition(code: number): Condition {
  if (code === 0) return { label: _("Clear_weather"), icons: ["weather-clear-symbolic"] }
  if (code <= 2) return { label: _("Partly cloudy"), icons: ["weather-few-clouds-symbolic"] }
  if (code === 3) return { label: _("Overcast"), icons: ["weather-overcast-symbolic"] }
  if (code <= 48) return { label: _("Fog"), icons: ["weather-fog-symbolic", "weather-overcast-symbolic"] }
  if (code <= 57) return { label: _("Drizzle"), icons: ["weather-showers-scattered-symbolic"] }
  if (code <= 67) return { label: _("Rain"), icons: ["weather-showers-symbolic"] }
  if (code <= 77) return { label: _("Snow"), icons: ["weather-snow-symbolic"] }
  if (code <= 82) return { label: _("Rain showers"), icons: ["weather-showers-symbolic"] }
  if (code <= 86) return { label: _("Snow showers"), icons: ["weather-snow-symbolic"] }
  return { label: _("Thunderstorm"), icons: ["weather-storm-symbolic"] }
}

/** One day of the forecast. */
export interface Day {
  /** ISO date, `2026-08-24`. */
  date: string
  high: number
  low: number
  label: string
  icon: string
}

export interface Now {
  temperature: number
  /** What it feels like, which is the number worth dressing by. */
  apparent: number
  humidity: number
  /** In whatever unit the API was asked for; km/h by default. */
  wind: number
  label: string
  icon: string
}

interface Response {
  current: {
    temperature_2m: number
    apparent_temperature: number
    relative_humidity_2m: number
    wind_speed_10m: number
    weather_code: number
  }
  daily: {
    time: string[]
    weather_code: number[]
    temperature_2m_max: number[]
    temperature_2m_min: number[]
  }
}

/** Days of forecast to ask for, today included. */
const DAYS = 4

/** Where the module is reporting from, once it knows. */
export interface Place {
  latitude: number
  longitude: number
  /** What to call it on screen. Empty when only coordinates were given. */
  name: string
}

interface GeocodeResponse {
  results?: Array<{
    name: string
    latitude: number
    longitude: number
    country?: string
    admin1?: string
  }>
}

/**
 * Turn a place name into coordinates and a name to display.
 *
 * The forecast API returns no name at all, so this is the only way the module
 * can say where it is reporting from. Open-Meteo's geocoder answers in the
 * user's own language when asked, which is why the locale goes with the query.
 */
async function geocode(name: string): Promise<Place | null> {
  // `en` rather than nothing as the fallback: the geocoder rejects an empty
  // language and answers in English for one it does not know.
  const language = (GLib.get_language_names()[0] ?? "en").slice(0, 2).toLowerCase()

  const search = query({ name, count: "1", language, format: "json" })
  const url = `https://geocoding-api.open-meteo.com/v1/search?${search}`

  try {
    const data = await getJson<GeocodeResponse>(url)
    const hit = data.results?.[0]
    if (!hit) {
      console.error(`manifold: weather: no place called "${name}"`)
      return null
    }

    // The bare name is ambiguous often enough to be worth qualifying -- there
    // are a dozen Springfields -- but a full address is too much for a panel,
    // so it stops at the country.
    return {
      latitude: hit.latitude,
      longitude: hit.longitude,
      name: hit.country ? `${hit.name}, ${hit.country}` : hit.name,
    }
  } catch (error) {
    console.error(`manifold: weather: could not look up "${name}": ${error}`)
    return null
  }
}

/**
 * A query string, encoded by hand.
 *
 * GJS is not a browser and has no `URLSearchParams`; `encodeURIComponent` is
 * one of the few web APIs it does carry.
 */
function query(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&")
}

function url(place: Place): string {
  const imperial = config.get().weather.units === "imperial"

  const search = query({
    latitude: String(place.latitude),
    longitude: String(place.longitude),
    current: "temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code",
    daily: "weather_code,temperature_2m_max,temperature_2m_min",
    // The API works the zone out from the coordinates, which is what makes
    // "today" the right day for a forecast somewhere other than here.
    timezone: "auto",
    forecast_days: String(DAYS),
    temperature_unit: imperial ? "fahrenheit" : "celsius",
    wind_speed_unit: imperial ? "mph" : "kmh",
  })

  return `https://api.open-meteo.com/v1/forecast?${search}`
}

@register({ GTypeName: "ManifoldWeather" })
export default class Weather extends GObject.Object {
  private static _instance: Weather | null = null

  static get_default(): Weather {
    if (!Weather._instance) Weather._instance = new Weather()
    return Weather._instance
  }

  private _now: Now | null = null
  private _forecast: Day[] = []
  private _error: string | null = null
  private _place: Place | null = null
  private timer: AstalIO.Time | null = null

  /** Conditions right now, or null until the first fetch lands. */
  @getter<Now | null>(Object)
  get now(): Now | null {
    return this._now
  }

  /** Today first. */
  @getter(Object)
  get forecast(): Day[] {
    return this._forecast
  }

  /**
   * Why the last fetch failed, or null.
   *
   * Kept rather than only logged: a laptop is offline often enough that "no
   * weather" needs to say which kind of nothing it is.
   */
  @getter<string | null>(String)
  get error(): string | null {
    return this._error
  }

  /** Where this is reporting from, once it has been worked out. */
  @getter<Place | null>(Object)
  get place(): Place | null {
    return this._place
  }

  constructor() {
    super()

    const { interval: minutes } = config.get().weather
    void this.refresh()

    // Weather does not move fast and the service is free; a slow poll is both
    // enough and polite.
    this.timer = interval(Math.max(5, minutes) * 60_000, () => void this.refresh())
  }

  /**
   * Work out where to report from, once per session.
   *
   * Coordinates win over the name when both are given, but the name is still
   * looked up -- it is the only source of something to call the place, and
   * somebody who set both wants their exact point *and* a label.
   */
  private async resolvePlace(): Promise<Place | null> {
    if (this._place) return this._place

    const { location, latitude, longitude } = config.get().weather
    const exact = latitude !== 0 || longitude !== 0
    const named = location.trim()

    if (named) {
      const found = await geocode(named)
      if (found) {
        this._place = exact ? { latitude, longitude, name: found.name } : found
        this.notify("place")
        return this._place
      }
      // The lookup failed. Coordinates, if there are any, still work.
    }

    if (!exact) return null

    this._place = { latitude, longitude, name: "" }
    this.notify("place")
    return this._place
  }

  async refresh(): Promise<void> {
    try {
      const place = await this.resolvePlace()
      if (!place) {
        this._error = "no location configured"
        this.notify("error")
        return
      }

      const data = await getJson<Response>(url(place))

      const current = condition(data.current.weather_code)
      this._now = {
        temperature: data.current.temperature_2m,
        apparent: data.current.apparent_temperature,
        humidity: data.current.relative_humidity_2m,
        wind: data.current.wind_speed_10m,
        label: current.label,
        icon: firstIcon(...current.icons, "weather-few-clouds-symbolic"),
      }

      this._forecast = data.daily.time.map((date, at) => {
        const day = condition(data.daily.weather_code[at] ?? 0)
        return {
          date,
          high: data.daily.temperature_2m_max[at] ?? 0,
          low: data.daily.temperature_2m_min[at] ?? 0,
          label: day.label,
          icon: firstIcon(...day.icons, "weather-few-clouds-symbolic"),
        }
      })

      this._error = null
    } catch (error) {
      this._error = `${error}`
      console.error(`manifold: weather: ${error}`)
    }

    this.notify("now")
    this.notify("forecast")
    this.notify("error")
  }

  destroy(): void {
    this.timer?.cancel()
    this.timer = null
  }
}
