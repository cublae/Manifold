import Niri from "./niri"
import { copyText } from "./clipboard"
import { toHex } from "../lib/color"
import { showOsd } from "../widgets/osd/bus"

/**
 * Pick a colour off the screen and put it on the clipboard.
 *
 * The picking is the compositor's job -- niri puts up a magnifying cursor and
 * reads the composited pixel -- so all that is left here is deciding what the
 * user gets afterwards. They get the hex on the clipboard, because that is the
 * only reason anyone picks a colour, and the overlay showing the colour itself,
 * because a clipboard write with no feedback looks exactly like nothing
 * happening.
 *
 * Cancelling is a normal outcome and passes silently.
 */
export async function pickColor(): Promise<string | null> {
  const rgb = await Niri.get_default().pickColor()
  if (!rgb) return null

  const hex = toHex(rgb)

  await copyText(hex).catch((error) =>
    console.error(`manifold: could not copy ${hex}: ${error}`),
  )

  showOsd({ icon: "color-select-symbolic", reading: { text: hex }, swatch: hex })
  return hex
}
