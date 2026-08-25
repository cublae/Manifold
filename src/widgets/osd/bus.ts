/**
 * A way in to the on-screen display.
 *
 * The OSD windows are built one per monitor and each keeps its own `show`
 * closure, which is right for the sources it watches itself -- volume,
 * brightness, the keyboard layout -- and useless to anything else. This is the
 * door for everything else: a colour picked off the screen, and whatever comes
 * after it.
 *
 * A message goes to every OSD, so it appears on whichever monitor the user is
 * looking at without anyone having to work out which one that is.
 */

/** What the overlay should read. */
export type OsdReading =
  | { level: number }
  | { text: string }

export interface OsdMessage {
  /** Themed icon name. Ignored when a swatch is given. */
  icon: string
  reading: OsdReading
  /**
   * A colour to show in place of the icon, as `#rrggbb`.
   *
   * A picked colour has to be shown as itself. No icon means the same thing,
   * and the hex string alone is a row of digits nobody can picture.
   */
  swatch?: string
}

type Listener = (message: OsdMessage) => void

const listeners = new Set<Listener>()

/** Raise the overlay on every monitor. */
export function showOsd(message: OsdMessage): void {
  for (const listener of listeners) listener(message)
}

/** Subscribe an OSD window. Returns an unsubscribe function for its teardown. */
export function onOsd(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
