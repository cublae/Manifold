import GdkPixbuf from "gi://GdkPixbuf?version=2.0"

/**
 * Pulling an accent colour out of a picture.
 *
 * "Dominant colour" is the wrong target for an accent. The largest area of a
 * photograph is usually sky, wall or shadow, and an accent made of those is a
 * grey smear that cannot be told apart from the panel behind it. What is wanted
 * is the most *present* colour that is also worth using as a colour -- so hues
 * are weighted by how saturated the pixels carrying them are, not merely
 * counted.
 *
 * The result is then forced into a band that works as `accent_bg_color`, which
 * carries white text: bright enough not to be mud, dark enough not to lose the
 * text on it. A wallpaper does not get to pick an unusable accent.
 */

/** Longest edge the image is scaled to before counting. */
const SAMPLE = 96

/** Hue buckets. 24 gives 15° each, which keeps orange and yellow apart. */
const BUCKETS = 24

/** Pixels below this saturation carry no hue worth voting with. */
const MIN_SATURATION = 0.18

/** Ignore near-black and near-white: their hue is noise. */
const MIN_VALUE = 0.15
const MAX_VALUE = 0.97

/** The band an accent has to land in to be usable behind white text. */
const ACCENT_SATURATION = { min: 0.45, max: 0.92 }
const ACCENT_VALUE = { min: 0.45, max: 0.82 }

interface Hsv {
  h: number
  s: number
  v: number
}

function rgbToHsv(r: number, g: number, b: number): Hsv {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const span = max - min

  let h = 0
  if (span !== 0) {
    if (max === r) h = ((g - b) / span) % 6
    else if (max === g) h = (b - r) / span + 2
    else h = (r - g) / span + 4
  }
  h = ((h * 60) % 360 + 360) % 360

  return { h, s: max === 0 ? 0 : span / max, v: max }
}

function hsvToRgb({ h, s, v }: Hsv): [number, number, number] {
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c

  const [r, g, b] =
    h < 60 ? [c, x, 0]
    : h < 120 ? [x, c, 0]
    : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c]
    : h < 300 ? [x, 0, c]
    : [c, 0, x]

  return [r + m, g + m, b + m]
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function hex([r, g, b]: [number, number, number]): string {
  const byte = (value: number) =>
    Math.round(clamp(value, 0, 1) * 255)
      .toString(16)
      .padStart(2, "0")
  return `#${byte(r)}${byte(g)}${byte(b)}`
}

/**
 * An accent colour for `path`, or null when the picture has no colour in it.
 *
 * Null is a real answer, not a failure: a greyscale wallpaper has no accent to
 * offer and the configured one should stand.
 */
export function accentFromImage(path: string): string | null {
  let pixbuf: GdkPixbuf.Pixbuf | null
  try {
    // Scaled on load, so a 5000-pixel-wide wallpaper never lands in memory at
    // full size just to be averaged.
    pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_scale(path, SAMPLE, SAMPLE, true)
  } catch (error) {
    console.error(`manifold: could not read the wallpaper ${path}: ${error}`)
    return null
  }
  if (!pixbuf) return null

  const pixels = pixbuf.get_pixels()
  const channels = pixbuf.get_n_channels()
  const rowstride = pixbuf.get_rowstride()
  const width = pixbuf.get_width()
  const height = pixbuf.get_height()

  // Per hue bucket: how much saturated colour voted for it, how many pixels
  // did the voting, and the sums needed to describe the winner.
  const weight = new Array<number>(BUCKETS).fill(0)
  const count = new Array<number>(BUCKETS).fill(0)
  const sumH = new Array<number>(BUCKETS).fill(0)
  const sumS = new Array<number>(BUCKETS).fill(0)
  const sumV = new Array<number>(BUCKETS).fill(0)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = y * rowstride + x * channels

      // A transparent pixel is not part of the picture.
      if (channels === 4 && pixels[at + 3]! < 128) continue

      const { h, s, v } = rgbToHsv(
        pixels[at]! / 255,
        pixels[at + 1]! / 255,
        pixels[at + 2]! / 255,
      )

      if (s < MIN_SATURATION || v < MIN_VALUE || v > MAX_VALUE) continue

      // Weighted by saturation, so a small vivid area outvotes a large washed
      // one -- which is the whole point of picking an accent rather than an
      // average.
      const bucket = Math.min(BUCKETS - 1, Math.floor((h / 360) * BUCKETS))
      weight[bucket]! += s
      count[bucket]! += 1
      sumH[bucket]! += h
      sumS[bucket]! += s
      sumV[bucket]! += v
    }
  }

  let best = -1
  let bestWeight = 0
  for (let bucket = 0; bucket < BUCKETS; bucket++) {
    if (weight[bucket]! > bestWeight) {
      bestWeight = weight[bucket]!
      best = bucket
    }
  }
  if (best < 0) return null

  // The bucket's own averages, not its centre: fifteen degrees is the
  // difference between a sky blue and a cyan, and it shows. Averaging inside a
  // bucket is safe from the wraparound that makes circular means awkward --
  // no bucket straddles 0.
  const n = count[best]!
  const h = sumH[best]! / n
  const s = clamp(sumS[best]! / n, ACCENT_SATURATION.min, ACCENT_SATURATION.max)
  const v = clamp(sumV[best]! / n, ACCENT_VALUE.min, ACCENT_VALUE.max)

  return hex(hsvToRgb({ h, s, v }))
}
