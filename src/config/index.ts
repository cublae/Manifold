import GLib from "gi://GLib"
import Gio from "gi://Gio"
import { readFile } from "ags/file"
import { createState } from "ags"

import { defaultConfig, type ManifoldConfig, type PartialConfig } from "./schema"

export * from "./schema"

/**
 * Configuration loading.
 *
 * The shell reads a single JSON file, deep-merged over `defaultConfig`, so a
 * user (or the Home Manager module) only ever has to state what differs. The
 * file is watched: edits reload in place without restarting the shell.
 */

export function configPath(): string {
  const override = GLib.getenv("MANIFOLD_CONFIG")
  if (override) return override
  return `${GLib.get_user_config_dir()}/manifold/config.json`
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Merge `override` onto `base`.
 *
 * Objects merge key-by-key; arrays and scalars replace wholesale. Replacing
 * arrays is deliberate -- a user listing `bar.modules.start` means "these, in
 * this order", not "these in addition to the defaults".
 */
function merge<T>(base: T, override: unknown): T {
  if (!isPlainObject(override)) return base
  if (!isPlainObject(base)) return override as T

  const result: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(override)) {
    result[key] = isPlainObject(value) ? merge((base as Record<string, unknown>)[key], value) : value
  }
  return result as T
}

function load(): ManifoldConfig {
  const path = configPath()

  // Deliberately silent: this module is imported by every invocation of the
  // binary, including the one-shot CLI ones, and a keybinding should not log.
  if (!GLib.file_test(path, GLib.FileTest.EXISTS)) return defaultConfig

  try {
    const parsed = JSON.parse(readFile(path)) as PartialConfig
    return merge(defaultConfig, parsed)
  } catch (error) {
    // A broken config must never take the shell down -- fall back and say so.
    console.error(`manifold: could not read ${path}, using defaults: ${error}`)
    return defaultConfig
  }
}

/**
 * The live configuration.
 *
 * Read the current value with `config.get()`, or bind it into a widget so the
 * widget follows edits to the file. Prefer deriving narrow bindings
 * (`config(c => c.clock.format)`) over binding the whole object.
 */
export const [config, setConfig] = createState<ManifoldConfig>(load())

let watching = false

// Nothing else holds a reference, and a collected monitor stops reporting.
const monitors: Gio.FileMonitor[] = []

/** Begin watching the config file. Safe to call more than once. */
export function watchConfig(onReload?: (next: ManifoldConfig) => void): void {
  if (watching) return
  watching = true

  const path = configPath()
  const dir = path.slice(0, path.lastIndexOf("/"))

  GLib.mkdir_with_parents(dir, 0o755)

  try {
    // Watch the directory rather than the file: editors write atomically by
    // renaming a temporary over the target, which a file-level watch stops
    // following. `monitor_directory` watches exactly one level, where a
    // recursive watch would try to descend into every subdirectory and throw
    // on the first one it cannot read.
    const monitor = Gio.File.new_for_path(dir).monitor_directory(
      Gio.FileMonitorFlags.NONE,
      null,
    )

    monitor.connect("changed", (_source: Gio.FileMonitor, file: Gio.File) => {
      if (file.get_path() !== path) return
      const next = load()
      setConfig(next)
      onReload?.(next)
    })

    monitors.push(monitor)
  } catch (error) {
    // A shell that cannot watch its config is still a perfectly usable shell,
    // and this must never stop the windows from being built.
    console.error(`manifold: cannot watch ${dir}, live reload is off: ${error}`)
  }
}

/** Snapshot accessor, for code outside a reactive scope. */
export function currentConfig(): ManifoldConfig {
  return config.get()
}
