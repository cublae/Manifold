import GLib from "gi://GLib"
import GObject, { register, getter } from "ags/gobject"
import { interval } from "ags/time"
import { subprocess } from "ags/process"
import type AstalIO from "gi://AstalIO"

import { config } from "../config"

/**
 * What `subprocess` actually hands back.
 *
 * Not `AstalIO.Process`: the AGS wrapper returns a thinner class of the same
 * name, and typing a field with the GIR one makes the two collide.
 */
type Subprocess = ReturnType<typeof subprocess>

/**
 * Screen recording through gpu-screen-recorder.
 *
 * Recording stops by sending SIGINT: gpu-screen-recorder finalises the
 * container on interrupt, where killing it outright leaves an unplayable file.
 *
 * Capture goes through the desktop portal. On this class of setup that is the
 * only target `--list-capture-options` offers -- direct DRM capture needs
 * privileges the session does not hand out -- and the portal session token is
 * kept so the shell does not re-prompt for a screen on every recording.
 */

function timestamp(): string {
  return GLib.DateTime.new_now_local().format("%Y-%m-%d_%H-%M-%S") ?? "recording"
}

@register({ GTypeName: "ManifoldRecorder" })
export default class Recorder extends GObject.Object {
  private static _instance: Recorder | null = null

  static get_default(): Recorder {
    if (!Recorder._instance) Recorder._instance = new Recorder()
    return Recorder._instance
  }

  private process: Subprocess | null = null
  private ticker: AstalIO.Time | null = null
  private startedAt = 0
  private _elapsed = 0
  private _path = ""

  /** True while a recording is running. */
  @getter(Boolean)
  get recording(): boolean {
    return this.process !== null
  }

  /** Seconds since recording started. */
  @getter(Number)
  get elapsed(): number {
    return this._elapsed
  }

  /** Where the current or most recent recording is being written. */
  @getter(String)
  get path(): string {
    return this._path
  }

  /** False when gpu-screen-recorder is not installed. */
  @getter(Boolean)
  get available(): boolean {
    return GLib.find_program_in_path("gpu-screen-recorder") !== null
  }

  toggle(): void {
    if (this.recording) this.stop()
    else this.start()
  }

  start(): void {
    if (this.recording || !this.available) return

    const cfg = config.get().screenRecord
    const directory = cfg.directory || `${GLib.get_home_dir()}/Videos`
    GLib.mkdir_with_parents(directory, 0o755)

    this._path = `${directory}/${timestamp()}.mp4`

    const argv = [
      "gpu-screen-recorder",
      "-w", cfg.target,
      "-f", String(cfg.fps),
      "-o", this._path,
      // Reusing the token means the portal picker appears once, not once per
      // recording.
      "-restore-portal-session", "yes",
      "-portal-session-token-filepath",
      `${GLib.get_user_config_dir()}/manifold/portal-session-token`,
    ]
    if (cfg.audio) argv.push("-a", cfg.audio)

    try {
      this.process = subprocess(
        argv,
        () => {},
        (error) => console.error(`manifold: gpu-screen-recorder: ${error}`),
      )
    } catch (error) {
      console.error(`manifold: could not start recording: ${error}`)
      return
    }

    this.startedAt = GLib.DateTime.new_now_local().to_unix()
    this._elapsed = 0
    this.ticker = interval(1000, () => {
      this._elapsed = GLib.DateTime.new_now_local().to_unix() - this.startedAt
      this.notify("elapsed")
    })

    this.notify("recording")
    this.notify("path")
  }

  stop(): void {
    if (!this.process) return

    // SIGINT, not kill: the recorder needs to write the container's index.
    this.process.signal(2)
    this.process = null

    this.ticker?.cancel()
    this.ticker = null
    this._elapsed = 0

    this.notify("recording")
    this.notify("elapsed")
    console.log(`manifold: recording saved to ${this._path}`)
  }

  destroy(): void {
    this.stop()
  }
}
