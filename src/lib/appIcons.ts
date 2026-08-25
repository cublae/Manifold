import Gdk from "gi://Gdk?version=4.0"
import { Gtk } from "ags/gtk4"
import { createState } from "ags"
import type AstalAppsNS from "gi://AstalApps"

import * as applications from "../services/applications"

/**
 * Resolving a window's `app_id` to an icon.
 *
 * niri reports only the Wayland app id. The icon lives in the application's
 * .desktop entry, so the entries are indexed once by every name an app id
 * plausibly matches -- the desktop file basename, the WM class, the display
 * name -- and looked up from there.
 *
 * The index is reactive: it is empty until AstalApps has loaded, and consumers
 * that include it in a computed re-render once it fills in. Without that the
 * first paint would show fallback icons forever.
 */

const FALLBACK = "application-x-executable"

const [appIcons, setAppIcons] = createState<Map<string, string>>(new Map())
export { appIcons }

let theme: Gtk.IconTheme | null = null

function iconTheme(): Gtk.IconTheme | null {
  if (theme) return theme
  const display = Gdk.Display.get_default()
  if (!display) return null
  theme = Gtk.IconTheme.get_for_display(display)
  return theme
}

/** `org.gnome.Nautilus.desktop` -> `org.gnome.nautilus` */
function entryKey(entry: string | null): string | null {
  if (!entry) return null
  return entry.replace(/\.desktop$/, "").toLowerCase()
}

let started = false

/** (Re)build the index from the current set of installed applications. */
function build(apps: AstalAppsNS.Application[]): void {
  const index = new Map<string, string>()

  for (const app of apps) {
    const icon = app.iconName
    if (!icon) continue

    // Later entries must not clobber earlier ones: the first match for a
    // key is as good as any, and rewriting makes the result order-dependent.
    for (const key of [entryKey(app.entry), app.wmClass, app.name]) {
      const normalised = key?.toLowerCase()
      if (normalised && !index.has(normalised)) index.set(normalised, icon)
    }
  }

  setAppIcons(index)
}

/** Build the index. Safe to call more than once; only the first call works. */
export function loadAppIcons(): void {
  if (started) return
  started = true

  const refresh = async () => build(await applications.applications())

  void refresh()

  // A newly installed program should not be stuck with the fallback icon until
  // the shell restarts, so the index follows the desktop directories.
  applications.onApplicationsChanged(() => void refresh())
}

/**
 * Best icon name for an app id.
 *
 * Falls back through progressively weaker guesses: the .desktop index is
 * authoritative, but plenty of applications (Steam games, for one) ship an icon
 * named exactly their app id without a matching entry, so the icon theme is
 * asked directly before giving up.
 */
export function resolveAppIcon(index: Map<string, string>, appId: string | null): string {
  if (!appId) return FALLBACK

  const key = appId.toLowerCase()
  const known = index.get(key)
  // An entry may name its icon by path; `icon-name` cannot draw one, and the
  // bar has no room for a file image, so the generic icon stands in.
  if (known) return known.startsWith("/") ? FALLBACK : known

  const icons = iconTheme()
  if (!icons) return FALLBACK

  if (icons.has_icon(appId)) return appId
  if (icons.has_icon(key)) return key

  // `org.gnome.Nautilus` -> `nautilus`
  const tail = key.split(".").pop()
  if (tail && tail !== key && icons.has_icon(tail)) return tail

  return FALLBACK
}
