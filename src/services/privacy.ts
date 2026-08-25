import GLib from "gi://GLib"
import Gio from "gi://Gio"
import GObject, { register, getter } from "ags/gobject"
import { interval } from "ags/time"
import type AstalIO from "gi://AstalIO"

import * as system from "./system"

/**
 * Who is listening and who is watching.
 *
 * Two very different questions with two very different answers. The microphone
 * is WirePlumber's to answer: an application recording audio holds a capture
 * stream, and AstalWp lists those along with the name of whoever owns them.
 *
 * The camera has no such registry. An application opens `/dev/videoN` directly
 * and nothing announces it, so the only honest way to tell is to look for a
 * process holding one of those nodes open -- which is what this does, by
 * walking `/proc`. That only sees the user's own processes, which in practice
 * is every application that would use a webcam.
 *
 * The camera scan is a poll rather than a watch, because there is nothing to
 * watch: opening a device file emits no signal anyone can subscribe to. It is
 * skipped outright on a machine with no video device, which costs nothing and
 * is the common case on a desktop.
 */

/** How often to look for a process holding the camera, in milliseconds. */
const CAMERA_POLL_MS = 3000

/** One application using a device it is worth knowing about. */
export interface Watcher {
  /** Human-readable name, as reported by the stream or the process. */
  name: string
}

function videoDevices(): string[] {
  let enumerator: Gio.FileEnumerator
  try {
    enumerator = Gio.File.new_for_path("/dev").enumerate_children(
      "standard::name",
      Gio.FileQueryInfoFlags.NONE,
      null,
    )
  } catch {
    return []
  }

  const found: string[] = []
  for (;;) {
    const info = enumerator.next_file(null)
    if (!info) break

    const name = info.get_name()
    // `video0`, not `video-something`: only the numbered nodes are capture
    // devices, and a machine has a handful of them at most.
    if (/^video\d+$/.test(name)) found.push(`/dev/${name}`)
  }
  enumerator.close(null)

  return found
}

/** Names of directories under /proc that are process ids. */
function processIds(): string[] {
  let enumerator: Gio.FileEnumerator
  try {
    enumerator = Gio.File.new_for_path("/proc").enumerate_children(
      "standard::name",
      Gio.FileQueryInfoFlags.NONE,
      null,
    )
  } catch {
    return []
  }

  const found: string[] = []
  for (;;) {
    const info = enumerator.next_file(null)
    if (!info) break

    const name = info.get_name()
    if (/^\d+$/.test(name)) found.push(name)
  }
  enumerator.close(null)

  return found
}

/**
 * The process's own name, as it would appear in a task list.
 *
 * `comm` rather than the full command line: a command line is a path plus a
 * screenful of flags, and the tooltip has room for a word.
 */
function processName(pid: string): string {
  try {
    const [ok, bytes] = GLib.file_get_contents(`/proc/${pid}/comm`)
    if (!ok) return pid
    return new TextDecoder().decode(bytes).trim() || pid
  } catch {
    return pid
  }
}

/** Processes holding one of `devices` open, by name. */
function cameraUsers(devices: string[]): Watcher[] {
  const names = new Set<string>()

  for (const pid of processIds()) {
    let enumerator: Gio.FileEnumerator
    try {
      enumerator = Gio.File.new_for_path(`/proc/${pid}/fd`).enumerate_children(
        "standard::name,standard::symlink-target",
        Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
        null,
      )
    } catch {
      // Someone else's process, or one that exited between the listing and
      // now. Both are ordinary and neither is worth a log line.
      continue
    }

    for (;;) {
      let info: Gio.FileInfo | null
      try {
        info = enumerator.next_file(null)
      } catch {
        break
      }
      if (!info) break

      const target = info.get_symlink_target()
      if (target && devices.includes(target)) {
        names.add(processName(pid))
        break
      }
    }
    enumerator.close(null)
  }

  return [...names].map((name) => ({ name }))
}

@register({ GTypeName: "ManifoldPrivacy" })
export default class Privacy extends GObject.Object {
  private static _instance: Privacy | null = null

  static get_default(): Privacy {
    if (!Privacy._instance) Privacy._instance = new Privacy()
    return Privacy._instance
  }

  private _microphone: Watcher[] = []
  private _camera: Watcher[] = []
  private _devices: string[] = []
  private timer: AstalIO.Time | null = null

  /** Applications currently recording audio. */
  @getter(Object)
  get microphone(): Watcher[] {
    return this._microphone
  }

  /** Applications currently holding a camera. */
  @getter(Object)
  get camera(): Watcher[] {
    return this._camera
  }

  @getter(Boolean)
  get microphoneInUse(): boolean {
    return this._microphone.length > 0
  }

  @getter(Boolean)
  get cameraInUse(): boolean {
    return this._camera.length > 0
  }

  constructor() {
    super()
    void this.watchMicrophone()
    this.watchCamera()
  }

  private async watchMicrophone(): Promise<void> {
    const wp = await system.wireplumber()
    const audio = wp?.audio
    if (!audio) return

    const sync = () => {
      // A muted stream is still an open microphone, and saying otherwise would
      // be the one lie this indicator must not tell: an application that mutes
      // itself can unmute itself.
      // `recorders` is nullable and holds streams rather than endpoints; the
      // type is left to the library rather than asserted here.
      const next = (audio.recorders ?? []).map((recorder) => ({
        name: recorder.description || recorder.name || "an application",
      }))

      const changed =
        next.length !== this._microphone.length ||
        next.some((watcher, at) => watcher.name !== this._microphone[at]?.name)
      if (!changed) return

      const wasInUse = this.microphoneInUse
      this._microphone = next
      this.notify("microphone")
      if (this.microphoneInUse !== wasInUse) this.notify("microphone-in-use")
    }

    audio.connect("notify::recorders", sync)
    sync()
  }

  private watchCamera(): void {
    this._devices = videoDevices()
    if (this._devices.length === 0) return

    const sync = () => {
      const next = cameraUsers(this._devices)

      const changed =
        next.length !== this._camera.length ||
        next.some((watcher, at) => watcher.name !== this._camera[at]?.name)
      if (!changed) return

      const wasInUse = this.cameraInUse
      this._camera = next
      this.notify("camera")
      if (this.cameraInUse !== wasInUse) this.notify("camera-in-use")
    }

    this.timer = interval(CAMERA_POLL_MS, sync)
  }

  destroy(): void {
    this.timer?.cancel()
    this.timer = null
  }
}
