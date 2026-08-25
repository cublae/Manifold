import GLib from "gi://GLib"
import Gio from "gi://Gio"
import { execAsync } from "ags/process"

/**
 * Where the wallpaper is.
 *
 * Wayland has no protocol for this and no compositor owns it: the wallpaper is
 * just another program painting a background layer, and each of those keeps its
 * own idea of what is on screen. So there is nothing to query -- only a list of
 * places to look, in the order of how much they can be trusted.
 *
 * An explicit path in the config beats all of it, which is the escape hatch for
 * anyone whose setter is not one of these.
 */

/** Where waypaper records the current wallpaper. */
function waypaperConfig(): string {
  return `${GLib.get_user_config_dir()}/waypaper/config.ini`
}

/** Expand a leading `~`, which is how waypaper stores paths. */
function expand(path: string): string {
  return path.startsWith("~/") ? `${GLib.get_home_dir()}/${path.slice(2)}` : path
}

/** The `wallpaper = ...` line out of waypaper's config, if there is one. */
function fromWaypaper(): string | null {
  const file = waypaperConfig()
  if (!GLib.file_test(file, GLib.FileTest.EXISTS)) return null

  try {
    const [ok, bytes] = GLib.file_get_contents(file)
    if (!ok) return null

    const match = /^\s*wallpaper\s*=\s*(.+?)\s*$/m.exec(new TextDecoder().decode(bytes))
    if (!match?.[1]) return null

    const path = expand(match[1])
    return GLib.file_test(path, GLib.FileTest.EXISTS) ? path : null
  } catch {
    return null
  }
}

/**
 * The image swww is showing, if swww is running.
 *
 * `swww query` prints one line per output, ending in the image path. Several
 * outputs can carry different wallpapers; the first is as good an answer as
 * any, since the accent is one colour for the whole shell either way.
 */
async function fromSwww(): Promise<string | null> {
  try {
    const output = await execAsync(["swww", "query"])
    for (const line of output.split("\n")) {
      const match = /image:\s*(.+?)\s*$/.exec(line)
      const path = match?.[1]
      if (path && GLib.file_test(path, GLib.FileTest.EXISTS)) return path
    }
  } catch {
    // Not installed, or not running. Both are ordinary.
  }
  return null
}

/**
 * The current wallpaper, or null if nothing here knows.
 *
 * `configured` is `theme.wallpaper` and wins outright, including when it points
 * at nothing -- a path that was typed and is wrong should be reported, not
 * quietly worked around.
 */
export async function currentWallpaper(configured: string): Promise<string | null> {
  const explicit = configured.trim()
  if (explicit) {
    const path = expand(explicit)
    if (GLib.file_test(path, GLib.FileTest.EXISTS)) return path

    console.error(`manifold: theme.wallpaper points at ${path}, which does not exist`)
    return null
  }

  return fromWaypaper() ?? (await fromSwww())
}

/**
 * Call `onChange` when the wallpaper looks like it changed.
 *
 * Only waypaper can be watched, because only waypaper writes the answer to a
 * file. swww keeps it in a running daemon with nothing to subscribe to, so a
 * swww user gets the colour picked at startup and on reload, which is the
 * honest limit rather than a poll that would spend the whole session asking.
 */
export function watchWallpaper(onChange: () => void): Gio.FileMonitor | null {
  const file = Gio.File.new_for_path(waypaperConfig())

  try {
    const monitor = file.monitor_file(Gio.FileMonitorFlags.NONE, null)
    monitor.connect("changed", (_monitor, _file, _other, event) => {
      // waypaper rewrites the file, so the useful signal is the write finishing.
      if (
        event === Gio.FileMonitorEvent.CHANGES_DONE_HINT ||
        event === Gio.FileMonitorEvent.CREATED
      ) {
        onChange()
      }
    })
    return monitor
  } catch (error) {
    console.error(`manifold: could not watch the wallpaper: ${error}`)
    return null
  }
}
