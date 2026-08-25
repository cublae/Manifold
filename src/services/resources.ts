import GLib from "gi://GLib"

/**
 * CPU load, memory use and CPU temperature.
 *
 * Everything comes from the kernel's own files -- `/proc/stat`, `/proc/meminfo`
 * and hwmon -- so this needs no daemon, no library and no permissions.
 *
 * Load is a difference between two readings rather than a number the kernel
 * keeps, so the first sample after start has nothing to compare against and
 * reports zero.
 */

export interface Resources {
  /** Share of the last interval the CPU spent working, 0..1. */
  cpu: number
  /** Share of RAM in use, 0..1. */
  memory: number
  /** CPU temperature in degrees, or null where nothing reports one. */
  temperature: number | null
}

export const EMPTY: Resources = { cpu: 0, memory: 0, temperature: null }

/** Sensors that mean "the CPU", most specific first. */
const CPU_SENSORS = ["k10temp", "zenpower", "coretemp", "cpu_thermal", "acpitz"]

function readFile(path: string): string | null {
  try {
    const [ok, bytes] = GLib.file_get_contents(path)
    return ok ? new TextDecoder().decode(bytes) : null
  } catch {
    return null
  }
}

let previous: { busy: number; total: number } | null = null

/**
 * `/proc/stat`'s first line is the sum over all cores, in jiffies since boot:
 * user, nice, system, idle, iowait, irq, softirq, steal. Idle and iowait are
 * the two the CPU was not working.
 */
function cpuLoad(): number {
  const line = readFile("/proc/stat")?.split("\n")[0]
  if (!line) return 0

  const values = line.split(/\s+/).slice(1).map(Number).filter(Number.isFinite)
  if (values.length < 5) return 0

  const total = values.reduce((sum, value) => sum + value, 0)
  const idle = values[3] + values[4]
  const busy = total - idle

  const last = previous
  previous = { busy, total }
  if (!last) return 0

  const span = total - last.total
  return span > 0 ? Math.min(1, Math.max(0, (busy - last.busy) / span)) : 0
}

function memoryUse(): number {
  const text = readFile("/proc/meminfo")
  if (!text) return 0

  const field = (name: string): number => {
    const match = new RegExp(`^${name}:\\s+(\\d+)`, "m").exec(text)
    return match ? Number(match[1]) : 0
  }

  const total = field("MemTotal")
  // MemAvailable is the kernel's own estimate of what a new process could get,
  // which is the number a user means by "free" -- caches included.
  const available = field("MemAvailable")

  return total > 0 ? Math.min(1, Math.max(0, (total - available) / total)) : 0
}

let sensorPath: string | null | undefined

/** hwmon numbering is not stable across boots, so the sensor is found by name. */
function findSensor(): string | null {
  const hwmon = "/sys/class/hwmon"
  const directory = GLib.Dir.open(hwmon, 0)

  const found = new Map<string, string>()
  for (;;) {
    const entry = directory.read_name()
    if (!entry) break

    const name = readFile(`${hwmon}/${entry}/name`)?.trim()
    const input = `${hwmon}/${entry}/temp1_input`
    if (name && !found.has(name) && GLib.file_test(input, GLib.FileTest.EXISTS)) {
      found.set(name, input)
    }
  }

  for (const sensor of CPU_SENSORS) {
    const path = found.get(sensor)
    if (path) return path
  }

  // Nothing recognisable: the first thermal zone is a poor guess but a guess.
  const zone = "/sys/class/thermal/thermal_zone0/temp"
  return GLib.file_test(zone, GLib.FileTest.EXISTS) ? zone : null
}

function temperature(): number | null {
  if (sensorPath === undefined) {
    try {
      sensorPath = findSensor()
    } catch {
      sensorPath = null
    }
  }
  if (!sensorPath) return null

  const raw = Number(readFile(sensorPath)?.trim())
  // Millidegrees, the way every hwmon reports.
  return Number.isFinite(raw) ? Math.round(raw / 1000) : null
}

/** One reading of all three. */
export function read(): Resources {
  return { cpu: cpuLoad(), memory: memoryUse(), temperature: temperature() }
}
