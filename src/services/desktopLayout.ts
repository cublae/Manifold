import GLib from "gi://GLib"

/**
 * Where each desktop widget sits, per monitor.
 *
 * Positions are grid cells rather than pixels, so a layout arranged on a laptop
 * screen still means something when the same config meets a 4K monitor: the
 * clock stays a third of the way down whatever the resolution is. Pixels would
 * put it off the edge.
 *
 * Kept in the state directory rather than the config: this is arranged by
 * dragging, not by editing a file, and a generated config file that Home
 * Manager owns is the wrong place for something the user moves with a mouse.
 */

export type WidgetId = "clock" | "date" | "media"

/**
 * Which way a widget grows from the grid point it sits on.
 *
 * `center` is right for anything in the middle of the screen and wrong at the
 * edges: a clock centred on column 0 hangs half of itself off the display.
 */
export type Anchor = "start" | "center" | "end"

/** The smallest and largest a widget may be scaled to. */
export const MIN_SCALE = 0.5
export const MAX_SCALE = 3

export interface Placement {
  /** Grid line indices, counted from the top left. */
  column: number
  row: number
  /** Font-size multiplier, `1` being whatever the stylesheet says. */
  scale: number
  anchor: Anchor
}

/** What a stored layout may hold: older files predate scale and anchor. */
type StoredPlacement = Partial<Placement> & { column: number; row: number }

/** Layouts keyed by output connector, then by widget. */
type Layouts = Record<string, Partial<Record<WidgetId, StoredPlacement>>>

/**
 * Where widgets start out.
 *
 * Centred horizontally and a little above the middle, which is where a clock
 * belongs on a wallpaper -- dead centre fights whatever the picture is of, and
 * the lower half is where a dock or a bar usually lives.
 */
export const DEFAULT_PLACEMENT: Record<WidgetId, Placement> = {
  clock: { column: 12, row: 6, scale: 1, anchor: "center" },
  date: { column: 12, row: 7, scale: 1, anchor: "center" },
  media: { column: 12, row: 8, scale: 1, anchor: "center" },
}

let layouts: Layouts | null = null
const listeners = new Set<() => void>()

function path(): string {
  return `${GLib.get_user_state_dir()}/manifold/desktop-layout.json`
}

function load(): Layouts {
  const file = path()
  if (!GLib.file_test(file, GLib.FileTest.EXISTS)) return {}

  try {
    const [ok, bytes] = GLib.file_get_contents(file)
    if (!ok) return {}

    const saved: unknown = JSON.parse(new TextDecoder().decode(bytes))
    return saved && typeof saved === "object" ? (saved as Layouts) : {}
  } catch (error) {
    console.error(`manifold: could not read the desktop layout: ${error}`)
    return {}
  }
}

function save(): void {
  const file = path()

  try {
    GLib.mkdir_with_parents(file.slice(0, file.lastIndexOf("/")), 0o700)
    GLib.file_set_contents(file, JSON.stringify(layouts ?? {}, null, 2))
  } catch (error) {
    console.error(`manifold: could not save the desktop layout: ${error}`)
  }
}

function all(): Layouts {
  layouts ??= load()
  return layouts
}

/**
 * Where `widget` sits on `output`, and how it is drawn.
 *
 * Fields the stored file does not carry fall back to the default, so a layout
 * written before scaling existed still loads.
 */
export function placement(output: string, widget: WidgetId): Placement {
  const fallback = DEFAULT_PLACEMENT[widget]
  const saved = all()[output]?.[widget]
  if (!saved) return fallback

  return {
    column: saved.column,
    row: saved.row,
    scale: clampScale(saved.scale ?? fallback.scale),
    anchor: saved.anchor ?? fallback.anchor,
  }
}

/** Keeps a scale usable however it got into the file. */
export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
}

/** Write a widget's placement out and tell every surface showing it. */
export function place(output: string, widget: WidgetId, at: Placement): void {
  const store = all()
  store[output] ??= {}
  store[output]![widget] = at

  save()
  for (const listener of listeners) listener()
}

/** Change part of a widget's placement, leaving the rest alone. */
export function adjust(
  output: string,
  widget: WidgetId,
  change: Partial<Placement>,
): void {
  place(output, widget, { ...placement(output, widget), ...change })
}

/** Put every widget on `output` back where it started. */
export function resetOutput(output: string): void {
  const store = all()
  delete store[output]

  save()
  for (const listener of listeners) listener()
}

export function onLayoutChanged(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
