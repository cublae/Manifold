/**
 * Unit conversion for the launcher's search field.
 *
 * A deliberately small table: the point is to answer "how many inches is 10 cm"
 * without leaving the keyboard, not to be a units library. Everything is
 * converted through one base unit per dimension, so a new unit is one line and
 * cannot disagree with the others.
 *
 * Temperature is the exception -- it has offsets, not just factors -- so it gets
 * its own pair of functions.
 */

/** Written as `<amount> <from> in|to <into>`. */
const SYNTAX = /^\s*(-?[0-9]+(?:[.,][0-9]+)?)\s*([a-z°]+)\s+(?:in|to|as|>)\s+([a-z°]+)\s*$/i

interface Unit {
  /** Same string for every unit that can convert into every other. */
  dimension: string
  /** How many base units one of these is. */
  factor: number
  /** How it is written back out. */
  symbol: string
}

const UNITS: Record<string, Unit> = {
  // -- length, base metre --
  mm: { dimension: "length", factor: 0.001, symbol: "mm" },
  cm: { dimension: "length", factor: 0.01, symbol: "cm" },
  m: { dimension: "length", factor: 1, symbol: "m" },
  km: { dimension: "length", factor: 1000, symbol: "km" },
  in: { dimension: "length", factor: 0.0254, symbol: "in" },
  inch: { dimension: "length", factor: 0.0254, symbol: "in" },
  inches: { dimension: "length", factor: 0.0254, symbol: "in" },
  ft: { dimension: "length", factor: 0.3048, symbol: "ft" },
  foot: { dimension: "length", factor: 0.3048, symbol: "ft" },
  feet: { dimension: "length", factor: 0.3048, symbol: "ft" },
  yd: { dimension: "length", factor: 0.9144, symbol: "yd" },
  mi: { dimension: "length", factor: 1609.344, symbol: "mi" },
  mile: { dimension: "length", factor: 1609.344, symbol: "mi" },
  miles: { dimension: "length", factor: 1609.344, symbol: "mi" },

  // -- mass, base kilogram --
  mg: { dimension: "mass", factor: 0.000001, symbol: "mg" },
  g: { dimension: "mass", factor: 0.001, symbol: "g" },
  kg: { dimension: "mass", factor: 1, symbol: "kg" },
  t: { dimension: "mass", factor: 1000, symbol: "t" },
  oz: { dimension: "mass", factor: 0.028349523125, symbol: "oz" },
  lb: { dimension: "mass", factor: 0.45359237, symbol: "lb" },
  lbs: { dimension: "mass", factor: 0.45359237, symbol: "lb" },

  // -- data, base byte. Powers of two, the way a file manager counts. --
  b: { dimension: "data", factor: 1, symbol: "B" },
  byte: { dimension: "data", factor: 1, symbol: "B" },
  bytes: { dimension: "data", factor: 1, symbol: "B" },
  kb: { dimension: "data", factor: 1024, symbol: "KB" },
  kib: { dimension: "data", factor: 1024, symbol: "KiB" },
  mb: { dimension: "data", factor: 1024 ** 2, symbol: "MB" },
  mib: { dimension: "data", factor: 1024 ** 2, symbol: "MiB" },
  gb: { dimension: "data", factor: 1024 ** 3, symbol: "GB" },
  gib: { dimension: "data", factor: 1024 ** 3, symbol: "GiB" },
  tb: { dimension: "data", factor: 1024 ** 4, symbol: "TB" },
  tib: { dimension: "data", factor: 1024 ** 4, symbol: "TiB" },

  // -- time, base second --
  ms: { dimension: "time", factor: 0.001, symbol: "ms" },
  s: { dimension: "time", factor: 1, symbol: "s" },
  sec: { dimension: "time", factor: 1, symbol: "s" },
  min: { dimension: "time", factor: 60, symbol: "min" },
  h: { dimension: "time", factor: 3600, symbol: "h" },
  hour: { dimension: "time", factor: 3600, symbol: "h" },
  hours: { dimension: "time", factor: 3600, symbol: "h" },
  d: { dimension: "time", factor: 86400, symbol: "d" },
  day: { dimension: "time", factor: 86400, symbol: "d" },
  days: { dimension: "time", factor: 86400, symbol: "d" },
}

/** Temperature, in and out of Celsius. */
const TEMPERATURES: Record<string, { symbol: string; toBase: (v: number) => number; fromBase: (v: number) => number }> = {
  c: { symbol: "°C", toBase: (v) => v, fromBase: (v) => v },
  "°c": { symbol: "°C", toBase: (v) => v, fromBase: (v) => v },
  celsius: { symbol: "°C", toBase: (v) => v, fromBase: (v) => v },
  f: { symbol: "°F", toBase: (v) => ((v - 32) * 5) / 9, fromBase: (v) => (v * 9) / 5 + 32 },
  "°f": { symbol: "°F", toBase: (v) => ((v - 32) * 5) / 9, fromBase: (v) => (v * 9) / 5 + 32 },
  fahrenheit: { symbol: "°F", toBase: (v) => ((v - 32) * 5) / 9, fromBase: (v) => (v * 9) / 5 + 32 },
  k: { symbol: "K", toBase: (v) => v - 273.15, fromBase: (v) => v + 273.15 },
  kelvin: { symbol: "K", toBase: (v) => v - 273.15, fromBase: (v) => v + 273.15 },
}

/** Trim floating-point noise without dropping meaningful digits. */
function format(value: number): string {
  if (Number.isInteger(value) && Math.abs(value) < 1e21) return String(value)
  return String(Number(value.toPrecision(10)))
}

/**
 * `10 cm in inch` -> `3.937007874 in`, or null when the query is not one.
 *
 * Returns null rather than an error for anything unrecognised: the same string
 * is on its way to the application search, and a half-typed word is not a
 * mistake worth reporting.
 */
export function convert(input: string): string | null {
  const match = SYNTAX.exec(input)
  if (!match) return null

  const amount = Number(match[1].replace(",", "."))
  if (!Number.isFinite(amount)) return null

  const from = match[2].toLowerCase()
  const into = match[3].toLowerCase()

  const fromTemperature = TEMPERATURES[from]
  const intoTemperature = TEMPERATURES[into]
  if (fromTemperature && intoTemperature) {
    const result = intoTemperature.fromBase(fromTemperature.toBase(amount))
    return `${format(result)} ${intoTemperature.symbol}`
  }

  const fromUnit = UNITS[from]
  const intoUnit = UNITS[into]
  if (!fromUnit || !intoUnit || fromUnit.dimension !== intoUnit.dimension) return null

  return `${format((amount * fromUnit.factor) / intoUnit.factor)} ${intoUnit.symbol}`
}
