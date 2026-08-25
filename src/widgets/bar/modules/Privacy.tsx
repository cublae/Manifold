import { Gtk } from "ags/gtk4"
import { createBinding, createComputed } from "ags"

import PrivacyService, { type Watcher } from "../../../services/privacy"

/**
 * Microphone and camera indicators.
 *
 * On screen only while something is using them, which is the entire value of
 * the thing: an indicator that is always there is furniture, and one that
 * appears is information. The tooltip names the application, because "something
 * is listening" invites a hunt through the process list.
 *
 * The two are separate icons rather than one privacy light. They mean different
 * things and are worth different reactions.
 */

function names(watchers: Watcher[]): string {
  return [...new Set(watchers.map((watcher) => watcher.name))].join(", ")
}

export default function Privacy(): Gtk.Widget {
  const privacy = PrivacyService.get_default()

  const microphone = createBinding(privacy, "microphone")
  const camera = createBinding(privacy, "camera")

  return (
    <box cssClasses={["manifold-privacy"]} valign={Gtk.Align.CENTER} spacing={2}>
      <image
        cssClasses={["manifold-module", "listening"]}
        iconName="audio-input-microphone-symbolic"
        visible={createBinding(privacy, "microphoneInUse")}
        tooltipText={createComputed([microphone], (list) => `Microphone in use: ${names(list)}`)}
      />
      <image
        cssClasses={["manifold-module", "watching"]}
        iconName="camera-web-symbolic"
        visible={createBinding(privacy, "cameraInUse")}
        tooltipText={createComputed([camera], (list) => `Camera in use: ${names(list)}`)}
      />
    </box>
  ) as Gtk.Widget
}
