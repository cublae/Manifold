/** Small helpers shared across widgets. Keep this free of GTK imports. */

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/** Shorten `text` to `max` characters, with an ellipsis. `max <= 0` disables. */
export function truncate(text: string, max: number): string {
  if (max <= 0 || text.length <= max) return text
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`
}

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

/** Validate a user-supplied colour before it reaches the CSS parser. */
export function isHexColor(value: string): boolean {
  return HEX_COLOR.test(value)
}

/**
 * Title-case an app id for display: `org.gnome.Nautilus` -> `Nautilus`,
 * `firefox` -> `Firefox`.
 */
export function prettifyAppId(appId: string | null): string {
  if (!appId) return ""
  const last = appId.split(".").pop() ?? appId
  return last.charAt(0).toUpperCase() + last.slice(1)
}
