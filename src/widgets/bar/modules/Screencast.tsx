import { Gtk } from "ags/gtk4"
import { createBinding, createComputed } from "ags"

import Niri from "../../../services/niri"
import { firstIcon } from "../../../lib/icons"
import type { Cast } from "../../../services/niri.types"

/**
 * Screen capture indicator.
 *
 * The compositor is the only thing that knows for certain who is looking at the
 * screen, and niri says so: every portal session and every wlr-screencopy
 * recorder shows up in `CastsChanged`, and nothing that is not capturing can.
 * That makes this an indicator rather than a guess -- unlike watching for OBS in
 * the process list, which misses a video call and lies about a recorder that has
 * been closed.
 *
 * It is only on screen while frames are actually flowing. A cast can exist and
 * be paused -- OBS on a scene that does not include the capture -- and lighting
 * up for one of those trains people to ignore the light.
 */

/** What is being captured, for the tooltip. */
function describe(cast: Cast): string {
  if ("Output" in cast.target) return `screen ${cast.target.Output.name}`

  if ("Window" in cast.target) {
    const window = Niri.get_default().window(cast.target.Window.id)
    const name = window?.title || window?.app_id
    return name ? `window “${name}”` : "a window"
  }

  return "the screen"
}

function tooltip(casts: Cast[]): string {
  const active = casts.filter((cast) => cast.is_active)
  if (active.length === 0) return ""

  const what = [...new Set(active.map(describe))].join(", ")
  return active.length === 1 ? `Capturing ${what}` : `${active.length} captures: ${what}`
}

export default function Screencast(): Gtk.Widget {
  const niri = Niri.get_default()
  const casts = createBinding(niri, "casts")
  const casting = createBinding(niri, "casting")

  return (
    <box
      cssClasses={["manifold-module", "manifold-screencast"]}
      valign={Gtk.Align.CENTER}
      visible={casting}
      tooltipText={createComputed([casts], tooltip)}
      spacing={6}
    >
      {/*
        `screen-shared-symbolic` is the name GNOME uses for exactly this, and
        it draws a screen rather than a camcorder. `camera-video-symbolic` was
        the obvious guess and the wrong one: in Tela it is a boxy cassette that
        reads as anything but a screen being watched.
      */}
      <image iconName={firstIcon("screen-shared-symbolic", "video-display-symbolic")} />
      <box cssClasses={["dot"]} valign={Gtk.Align.CENTER} />
    </box>
  ) as Gtk.Widget
}
