import GLib from "gi://GLib"
import Gio from "gi://Gio"
import type AstalAppsNS from "gi://AstalApps"
import type GioUnixNS from "gi://GioUnix?version=2.0"

import { config } from "../config"
import * as system from "./system"

/**
 * The list of installed applications, kept honest across installs.
 *
 * `AstalApps` builds its list from `Gio.AppInfo.get_all()`, and GIO indexes the
 * XDG application directories once per process. It does re-index when one of
 * them changes, but only because it watches them -- and a watch resolves the
 * path it was given, so a directory that is *replaced* is invisible to it.
 * That is exactly what installing a package on NixOS does: the profile symlink
 * is swapped for a new one, the old directory it pointed at never changes, and
 * every long-running process keeps serving the old menu. `AstalApps.reload()`
 * cannot help, because it asks the same cached GIO database.
 *
 * So the directories are read here instead. `Gio.DesktopAppInfo` built straight
 * from a filename bypasses the index, which makes a fresh scan authoritative.
 * AstalApps is still what ranks and launches the results -- only the discovery
 * moves out of it, so scoring, weights and the launch counter stay as they are.
 */

/** Entries indexed by desktop file id, e.g. `firefox.desktop`. */
type Entries = Map<string, AstalAppsNS.Application>

let cached: Entries | null = null
const listeners = new Set<() => void>()
let appInfoMonitor: Gio.AppInfoMonitor | null = null

/**
 * `DesktopAppInfo`, under whichever name this GLib has it.
 *
 * GLib 2.80 moved the Unix-specific classes into their own typelib, and GJS
 * prints a warning with a stack trace on every use of the old name. The old
 * name still works, so it stays as the fallback.
 */
// Typed through GioUnix, which is where the class lives now; the Gio spelling
// below is a runtime fallback for an older GLib and has no type to point at.
type DesktopAppInfoClass = {
  new_from_filename: (filename: string) => GioUnixNS.DesktopAppInfo | null
}

let desktopAppInfo: DesktopAppInfoClass | null = null

async function desktopAppInfoClass(): Promise<DesktopAppInfoClass> {
  if (desktopAppInfo) return desktopAppInfo

  try {
    const GioUnix = (await import("gi://GioUnix?version=2.0")).default
    desktopAppInfo = GioUnix.DesktopAppInfo as unknown as DesktopAppInfoClass
  } catch {
    desktopAppInfo = (Gio as unknown as Record<string, unknown>)
      .DesktopAppInfo as DesktopAppInfoClass
  }

  return desktopAppInfo
}

/** Every directory the desktop entry spec says to look in, in precedence order. */
function applicationDirs(): string[] {
  return [GLib.get_user_data_dir(), ...GLib.get_system_data_dirs()].map(
    (dir) => `${dir}/applications`,
  )
}

/**
 * Desktop file ids below `root`, as `[id, path]`.
 *
 * Subdirectories are part of the spec: their entries take the directory into
 * the id, so `kde/foo.desktop` is `kde-foo.desktop`.
 */
function entryFiles(root: string, prefix = "", depth = 0): Array<[string, string]> {
  // Deep trees do not occur in practice; the limit is only there so a symlink
  // loop cannot hang the shell.
  if (depth > 4) return []

  let enumerator: Gio.FileEnumerator
  try {
    enumerator = Gio.File.new_for_path(root).enumerate_children(
      "standard::name,standard::type",
      Gio.FileQueryInfoFlags.NONE,
      null,
    )
  } catch {
    // A directory listed in XDG_DATA_DIRS need not exist.
    return []
  }

  const found: Array<[string, string]> = []
  for (;;) {
    const info = enumerator.next_file(null)
    if (!info) break

    const name = info.get_name()
    const path = `${root}/${name}`

    if (info.get_file_type() === Gio.FileType.DIRECTORY) {
      found.push(...entryFiles(path, `${prefix}${name}-`, depth + 1))
    } else if (name.endsWith(".desktop")) {
      found.push([`${prefix}${name}`, path])
    }
  }
  enumerator.close(null)
  return found
}

/**
 * Read every application from disk.
 *
 * The first directory to define an id wins, which is the precedence the spec
 * gives `XDG_DATA_HOME` over the system directories.
 *
 * Entries AstalApps already knows are carried over as its own objects rather
 * than rebuilt: those hold the launch counter it persists, and reusing them
 * keeps the ordering and the counting exactly as they were. Only what it has
 * never seen -- which is to say, what was installed since the shell started --
 * is built here.
 */
function scan(
  Application: typeof AstalAppsNS.Application,
  DesktopAppInfo: DesktopAppInfoClass,
  known: Map<string, AstalAppsNS.Application>,
  showHidden: boolean,
): Entries {
  const entries: Entries = new Map()

  for (const dir of applicationDirs()) {
    for (const [id, path] of entryFiles(dir)) {
      if (entries.has(id)) continue

      const existing = known.get(id)
      if (existing) {
        entries.set(id, existing)
        continue
      }

      // Returns null for a malformed entry and for `Hidden=true`, which the
      // spec defines as "deleted".
      const info = DesktopAppInfo.new_from_filename(path)
      if (!info) continue
      if (info.get_nodisplay() && !showHidden) continue

      // `app` is a construct-only property the introspection data does not
      // describe, so the generated types have no place to put it.
      entries.set(id, new Application({ app: info } as never))
    }
  }

  return entries
}

/** Re-read the directories and tell everyone who indexed them. */
export async function refreshApplications(): Promise<void> {
  const AstalApps = await system.astalApps()
  const index = await system.apps()
  if (!AstalApps || !index) return

  const known = new Map<string, AstalAppsNS.Application>()
  for (const app of index.get_list()) {
    if (app.entry) known.set(app.entry, app)
  }

  cached = scan(
    AstalApps.Application,
    await desktopAppInfoClass(),
    known,
    config.get().launcher.showHidden,
  )
  for (const listener of listeners) listener()
}

/**
 * Every installed application, most-launched first.
 *
 * Scans on first use, then serves the cache until something refreshes it.
 */
export async function applications(): Promise<AstalAppsNS.Application[]> {
  if (!cached) await refreshApplications()
  if (!cached) return []

  return [...cached.values()].sort(
    (a, b) => b.frequency - a.frequency || a.name.localeCompare(b.name),
  )
}

/**
 * Run `listener` whenever the set of installed applications changes.
 *
 * GIO's own monitor covers a package manager writing into a directory it
 * watches. It misses a directory being replaced, so callers that must be right
 * on demand -- the launcher on its way open -- also refresh explicitly.
 */
export function onApplicationsChanged(listener: () => void): void {
  listeners.add(listener)

  if (appInfoMonitor) return
  appInfoMonitor = Gio.AppInfoMonitor.get()
  appInfoMonitor.connect("changed", () => void refreshApplications())
}
