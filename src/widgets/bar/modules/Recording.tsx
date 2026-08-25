import { Gtk } from "ags/gtk4"
import { createBinding, createComputed } from "ags"
import { createPoll } from "ags/time"
import { _ } from "../../../lib/i18n"

import Recorder from "../../../services/recorder"

/**
 * Screen recording indicator.
 *
 * Only on screen while something is being recorded, which is the whole point: a
 * recording nobody can see running is how people end up with an hour of footage
 * they never meant to take. Pressing it stops the recording.
 */

function elapsed(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const rest = Math.floor(seconds % 60)
  return `${minutes}:${String(rest).padStart(2, "0")}`
}

export default function Recording(): Gtk.Widget {
  const recorder = Recorder.get_default()
  const recording = createBinding(recorder, "recording")

  // The service counts the seconds, but nothing notifies once a second, so the
  // label runs off its own tick while a recording is up.
  const tick = createPoll(0, 1000, (n: number) => n + 1)
  const time = createComputed([recording, tick], (on) => (on ? elapsed(recorder.elapsed) : ""))

  return (
    <button
      cssClasses={["manifold-module", "manifold-recording"]}
      tooltipText={_("Stop recording")}
      valign={Gtk.Align.CENTER}
      visible={recording}
      onClicked={() => recorder.stop()}
    >
      <box spacing={6}>
        <box cssClasses={["dot"]} valign={Gtk.Align.CENTER} />
        <label label={time} />
      </box>
    </button>
  ) as Gtk.Widget
}
