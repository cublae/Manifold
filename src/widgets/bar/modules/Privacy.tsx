import { Gtk } from "ags/gtk4"
import { createBinding, createComputed, createState } from "ags"

import type AstalWpNS from "gi://AstalWp"
import PrivacyService, { type Watcher } from "../../../services/privacy"
import * as system from "../../../services/system"
import { _ } from "../../../lib/i18n"

/**
 * Microphone and camera indicators.
 *
 * On screen only while something is using them, which is the entire value of
 * the thing: an indicator that is always there is furniture, and one that
 * appears is information. The tooltip names the application, because "something
 * is listening" invites a hunt through the process list.
 *
 * The two are separate icons rather than one privacy light. They mean different
 * things and are worth different reactions -- and only one of them has an
 * answer: the microphone can be muted from here, where noticing it and doing
 * something about it are the same gesture. A camera has no equivalent, so it
 * stays an indicator and nothing more.
 */

function names(watchers: Watcher[]): string {
  return [...new Set(watchers.map((watcher) => watcher.name))].join(", ")
}

export default function Privacy(): Gtk.Widget {
  const privacy = PrivacyService.get_default()

  const microphone = createBinding(privacy, "microphone")
  const camera = createBinding(privacy, "camera")

  // Mirrored into state rather than bound to the endpoint directly: the
  // endpoint arrives asynchronously, and the icon has to be drawable before it
  // does.
  const [muted, setMuted] = createState(false)
  let input: AstalWpNS.Endpoint | null = null

  const mic = (
    <button
      cssClasses={muted.as((off) => ["manifold-module", "listening", ...(off ? ["muted"] : [])])}
      visible={createBinding(privacy, "microphoneInUse")}
      tooltipText={createComputed([microphone, muted], (list, off) =>
        off ? `${_("Microphone muted")}: ${names(list)}` : `${_("Microphone in use")}: ${names(list)}`,
      )}
      onClicked={() => {
        if (input) input.mute = !input.mute
      }}
    >
      <image
        iconName={muted.as((off) =>
          off ? "microphone-disabled-symbolic" : "audio-input-microphone-symbolic",
        )}
      />
    </button>
  ) as Gtk.Widget

  void (async () => {
    const endpoint = await system.microphone()
    if (!endpoint) return
    input = endpoint

    const follow = () => setMuted(endpoint.mute)
    follow()

    const id = endpoint.connect("notify::mute", follow)
    mic.connect("destroy", () => endpoint.disconnect(id))
  })()

  return (
    <box cssClasses={["manifold-privacy"]} valign={Gtk.Align.CENTER} spacing={2}>
      {mic}
      <image
        cssClasses={["manifold-module", "watching"]}
        iconName="camera-web-symbolic"
        visible={createBinding(privacy, "cameraInUse")}
        tooltipText={createComputed([camera], (list) => `${_("Camera in use")}: ${names(list)}`)}
      />
    </box>
  ) as Gtk.Widget
}
