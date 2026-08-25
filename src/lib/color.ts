/** Colour conversions for the picker. */

/** One 0..1 channel as a two-digit hex byte. */
function channel(value: number): string {
  const byte = Math.round(Math.min(1, Math.max(0, value)) * 255)
  return byte.toString(16).padStart(2, "0")
}

/** `#rrggbb` from three 0..1 channels, which is how niri reports a picked colour. */
export function toHex([r, g, b]: [number, number, number]): string {
  return `#${channel(r)}${channel(g)}${channel(b)}`
}

/** `rgb(r, g, b)` in 0..255, the other form people paste into things. */
export function toRgb([r, g, b]: [number, number, number]): string {
  const byte = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 255)
  return `rgb(${byte(r)}, ${byte(g)}, ${byte(b)})`
}
