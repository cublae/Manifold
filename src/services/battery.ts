import GLib from "gi://GLib"
import GObject, { register, getter } from "ags/gobject"
import { interval } from "ags/time"
import type AstalIO from "gi://AstalIO"

/**
 * Battery state, from UPower when it is running and from sysfs when it is not.
 *
 * UPower is the richer source -- it normalises states, estimates time remaining
 * and also reports peripheral batteries (Bluetooth headsets, mice) -- but it is
 * a daemon a system may simply not run. The kernel always exposes the built-in
 * battery under /sys/class/power_supply, so that is the fallback and the shell
 * shows a battery either way.
 *
 * Consumers see one interface and do not care which backend answered.
 */

const SYSFS = "/sys/class/power_supply"

/** Battery percentage moves slowly; a slow poll is invisible to the user. */
const POLL_MS = 15_000

export type BatteryState = "charging" | "discharging" | "full" | "not-charging" | "unknown"

export type BatteryBackend = "upower" | "sysfs" | "none"

/** Read a sysfs attribute, returning null for anything unreadable. */
function readSys(path: string): string | null {
  try {
    const [ok, bytes] = GLib.file_get_contents(path)
    if (!ok) return null
    return new TextDecoder().decode(bytes).trim()
  } catch {
    return null
  }
}

function readNumber(path: string): number | null {
  const raw = readSys(path)
  if (raw === null) return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

/**
 * Map a level and state onto Adwaita's battery icons.
 *
 * The `battery-level-N-*` family exists in 10% steps, with `-charging-`,
 * `-plugged-in-` and plain variants. `plugged-in` is the right icon for the
 * "on AC but not actually charging" state that laptops with a charge threshold
 * sit in for most of their life.
 */
export function batteryIcon(percentage: number, state: BatteryState): string {
  const level = Math.min(100, Math.max(0, Math.round(percentage * 10) * 10))

  if (state === "full") return "battery-level-100-charged-symbolic"
  if (state === "charging") {
    return level >= 100
      ? "battery-level-100-charged-symbolic"
      : `battery-level-${level}-charging-symbolic`
  }
  if (state === "not-charging") return `battery-level-${level}-plugged-in-symbolic`
  return `battery-level-${level}-symbolic`
}

function parseSysfsStatus(status: string | null): BatteryState {
  switch (status) {
    case "Charging":
      return "charging"
    case "Discharging":
      return "discharging"
    case "Full":
      return "full"
    // Reported by laptops that stop charging at a configured threshold.
    case "Not charging":
      return "not-charging"
    default:
      return "unknown"
  }
}

@register({ GTypeName: "ManifoldBattery" })
export default class Battery extends GObject.Object {
  private static _instance: Battery | null = null

  static get_default(): Battery {
    if (!Battery._instance) Battery._instance = new Battery()
    return Battery._instance
  }

  private _available = false
  private _percentage = 0
  private _state: BatteryState = "unknown"
  private _iconName = "battery-missing-symbolic"
  private _timeRemaining = 0
  private _backend: BatteryBackend = "none"

  private poll: AstalIO.Time | null = null

  /** False until a battery is found. Widgets should bind their visibility. */
  @getter(Boolean)
  get available(): boolean {
    return this._available
  }

  /** Charge level, 0..1. */
  @getter(Number)
  get percentage(): number {
    return this._percentage
  }

  @getter(String)
  get state(): BatteryState {
    return this._state
  }

  @getter(Boolean)
  get charging(): boolean {
    return this._state === "charging"
  }

  /** True whenever the machine is running off the battery. */
  @getter(Boolean)
  get discharging(): boolean {
    return this._state === "discharging"
  }

  @getter(String)
  get iconName(): string {
    return this._iconName
  }

  /** Seconds until empty (or until full while charging). 0 when unknown. */
  @getter(Number)
  get timeRemaining(): number {
    return this._timeRemaining
  }

  /** Which source answered. Useful in logs and in the control center tooltip. */
  @getter(String)
  get backend(): BatteryBackend {
    return this._backend
  }

  constructor() {
    super()
    void this.init()
  }

  private async init(): Promise<void> {
    if (await this.startUPower()) return
    if (this.startSysfs()) return
    console.log("manifold: no battery found (neither UPower nor sysfs)")
  }

  // -- UPower --------------------------------------------------------------

  private async startUPower(): Promise<boolean> {
    try {
      const AstalBattery = (await import("gi://AstalBattery")).default
      const device = AstalBattery.get_default()

      // Without the daemon, AstalBattery still hands back a device -- an empty
      // one with is_present false. That is the signal to fall through.
      if (!device?.isPresent) return false

      this._backend = "upower"

      const sync = () => {
        const charging = device.charging
        const percentage = device.percentage

        let state: BatteryState = "unknown"
        if (percentage >= 1 && !device.timeToFull) state = "full"
        if (charging) state = "charging"
        else if (device.timeToEmpty > 0) state = "discharging"

        this.update({
          available: true,
          percentage,
          state,
          // UPower already resolves an icon; it knows more than we do.
          iconName: device.iconName || batteryIcon(percentage, state),
          timeRemaining: charging ? device.timeToFull : device.timeToEmpty,
        })
      }

      device.connect("notify", sync)
      sync()

      console.log("manifold: battery via UPower")
      return true
    } catch (error) {
      console.log(`manifold: UPower unavailable (${error})`)
      return false
    }
  }

  // -- sysfs ---------------------------------------------------------------

  /** First power-supply device whose `type` is `Battery`. */
  private findSysfsBattery(): string | null {
    try {
      const dir = GLib.Dir.open(SYSFS, 0)
      let name: string | null

      while ((name = dir.read_name()) !== null) {
        const path = `${SYSFS}/${name}`
        if (readSys(`${path}/type`) !== "Battery") continue
        if (readNumber(`${path}/capacity`) === null) continue
        return path
      }
    } catch {
      // No /sys/class/power_supply at all: a desktop, or a container.
    }
    return null
  }

  private startSysfs(): boolean {
    const path = this.findSysfsBattery()
    if (!path) return false

    this._backend = "sysfs"
    // `interval` fires immediately, then every POLL_MS.
    this.poll = interval(POLL_MS, () => this.readSysfsBattery(path))

    console.log(`manifold: battery via sysfs (${path})`)
    return true
  }

  private readSysfsBattery(path: string): void {
    const capacity = readNumber(`${path}/capacity`)
    if (capacity === null) return

    const percentage = capacity / 100
    const state = parseSysfsStatus(readSys(`${path}/status`))

    this.update({
      available: true,
      percentage,
      state,
      iconName: batteryIcon(percentage, state),
      timeRemaining: this.estimateSysfsTime(path, state),
    })
  }

  /**
   * Estimate seconds remaining from charge and current.
   *
   * Batteries report either charge/current (Ah) or energy/power (Wh); both
   * divide to hours. The rate reads zero whenever the battery is idle -- on AC
   * with a full charge, say -- and then there is nothing to estimate.
   */
  private estimateSysfsTime(path: string, state: BatteryState): number {
    if (state !== "discharging" && state !== "charging") return 0

    const chargeNow = readNumber(`${path}/charge_now`) ?? readNumber(`${path}/energy_now`)
    const rate = readNumber(`${path}/current_now`) ?? readNumber(`${path}/power_now`)
    if (!chargeNow || !rate || rate <= 0) return 0

    if (state === "discharging") return Math.round((chargeNow / rate) * 3600)

    const full = readNumber(`${path}/charge_full`) ?? readNumber(`${path}/energy_full`)
    if (!full || full <= chargeNow) return 0
    return Math.round(((full - chargeNow) / rate) * 3600)
  }

  // -- change notification -------------------------------------------------

  private update(next: {
    available: boolean
    percentage: number
    state: BatteryState
    iconName: string
    timeRemaining: number
  }): void {
    const wasCharging = this.charging
    const wasDischarging = this.discharging

    if (this._available !== next.available) {
      this._available = next.available
      this.notify("available")
    }
    if (this._percentage !== next.percentage) {
      this._percentage = next.percentage
      this.notify("percentage")
    }
    if (this._state !== next.state) {
      this._state = next.state
      this.notify("state")
      if (this.charging !== wasCharging) this.notify("charging")
      if (this.discharging !== wasDischarging) this.notify("discharging")
    }
    if (this._iconName !== next.iconName) {
      this._iconName = next.iconName
      this.notify("icon-name")
    }
    if (this._timeRemaining !== next.timeRemaining) {
      this._timeRemaining = next.timeRemaining
      this.notify("time-remaining")
    }
  }

  destroy(): void {
    this.poll?.cancel()
    this.poll = null
  }
}
