import Gdk from "gi://Gdk?version=4.0"
import type { Astal } from "ags/gtk4"
import app from "ags/gtk4/app"
import { createRoot } from "ags"

import Bar from "./bar/Bar"
import CalendarPopup from "./calendar/CalendarPopup"
import ControlCenter from "./control-center/ControlCenter"
import ClipboardPopup from "./clipboard/ClipboardPopup"
import Launcher from "./launcher/Launcher"
import NotificationCenter from "./notifications/NotificationCenter"
import NotificationPopups from "./notifications/NotificationPopups"
import WeatherPopup from "./weather/WeatherPopup"
import Desktop from "./desktop/Desktop"
import Osd from "./osd/Osd"
import { WindowName, togglePopup } from "./names"
import { config, type ManifoldConfig } from "../config"

/**
 * Window registry.
 *
 * Everything the shell puts on screen is created and destroyed here, so a
 * config reload can rebuild the whole surface set from one place and the IPC
 * handler in `app.ts` has a single vocabulary of window names to toggle.
 *
 * The names themselves live in `names.ts` so that widgets can toggle each other
 * without importing this module, which would be an import cycle.
 */

export { WindowName, togglePopup }

let monitorHandler: number | null = null

/**
 * A window and the reactive scope it was built in.
 *
 * Every window gets its own root rather than sharing one, because a rebuild
 * keeps some windows and replaces others: a shared scope could not be disposed
 * without breaking the survivors.
 */
interface Managed {
  window: Astal.Window
  dispose: () => void
}

let managed: Managed[] = []

function monitorsFor(cfg: ManifoldConfig): Gdk.Monitor[] {
  const monitors = app.get_monitors()
  return cfg.bar.onAllMonitors ? monitors : monitors.slice(0, 1)
}

/**
 * Build one window inside its own reactive root.
 *
 * Widgets register cleanup against the scope that is current while they are
 * constructed. `main()` happens to run inside one, so the first build works by
 * accident; a rebuild from a config reload does not, and every binding in it
 * fails with "out of tracking context". Owning the root here makes both paths
 * the same.
 */
function create(build: () => Astal.Window | void): void {
  const entry = createRoot((dispose) => {
    const window = build()
    return window ? { window, dispose } : null
  })

  if (entry) managed.push(entry)
}

function has(name: string): boolean {
  return managed.some((entry) => entry.window.name === name)
}

/**
 * Tear down the windows that can be torn down.
 *
 * A layer-shell surface only exists once its window has been shown. Destroying
 * a window that never was -- a dropdown the user has not opened yet -- takes
 * gtk4-layer-shell into a surface that is not there and segfaults the shell, so
 * those are left standing and reused by the next build instead. They hold no
 * state worth rebuilding: what they read from the config is applied by the
 * stylesheet, which a reload replaces wholesale.
 */
export function destroyWindows(): void {
  const kept: Managed[] = []

  for (const entry of managed) {
    if (!entry.window.get_realized()) {
      kept.push(entry)
      continue
    }
    entry.dispose()
    entry.window.destroy()
  }

  managed = kept
}

/** Build the window set described by the current config. */
export function buildWindows(): void {
  const cfg = config.get()

  // -- per-monitor surfaces ------------------------------------------------
  for (const monitor of monitorsFor(cfg)) {
    const perMonitor: Array<[boolean, string, () => Astal.Window | void]> = [
      [cfg.bar.enabled, "bar", () => Bar({ monitor })],
      [cfg.modules.notifications, "notification-popups", () => NotificationPopups(monitor)],
      [cfg.modules.osd, "osd", () => Osd(monitor)],
      [cfg.desktop.enabled, "desktop", () => Desktop({ monitor })],
    ]

    for (const [enabled, name, build] of perMonitor) {
      if (!enabled) continue
      try {
        create(build)
      } catch (error) {
        console.error(
          `manifold: could not create "${name}" on ${monitor.get_connector()}: ${error}`,
        )
      }
    }
  }

  // -- single surfaces -----------------------------------------------------
  // Dropdowns are created hidden and live for the whole session: toggling is
  // far cheaper than rebuilding on every click, and it preserves their state
  // (the selected month, a scroll position) between openings.
  const shared: Array<[boolean, string, () => Astal.Window]> = [
    [true, WindowName.Calendar, CalendarPopup],
    [cfg.modules.controlCenter, WindowName.ControlCenter, ControlCenter],
    [cfg.modules.notifications, WindowName.NotificationCenter, NotificationCenter],
    [cfg.modules.launcher, WindowName.Launcher, Launcher],
    [cfg.modules.clipboard, WindowName.Clipboard, ClipboardPopup],
    // Built only where a location is set. Without one the bar module is
    // invisible too, and a dropdown from nothing is a window that can only be
    // opened by accident.
    [
      cfg.weather.latitude !== 0 ||
        cfg.weather.longitude !== 0 ||
        cfg.weather.location.trim() !== "",
      WindowName.Weather,
      WeatherPopup,
    ],
  ]

  for (const [enabled, name, build] of shared) {
    // A dropdown that survived the teardown is still good; building a second
    // one would leave two windows answering to the same name.
    if (!enabled || has(name)) continue
    try {
      create(build)
    } catch (error) {
      console.error(`manifold: could not create "${name}": ${error}`)
    }
  }
}

/** Rebuild every window. Used on config reload and monitor hotplug. */
export function rebuildWindows(): void {
  destroyWindows()
  buildWindows()
}

/**
 * Create the initial windows and keep them in step with monitor hotplug.
 *
 * Monitors come and go when a lid closes or a cable is pulled; without this the
 * shell would keep a bar bound to a Gdk.Monitor that no longer exists.
 */
export function registerWindows(): void {
  buildWindows()

  // v3 exposes monitors as a notifying property on the application itself,
  // so hotplug needs no Gdk bookkeeping of its own.
  monitorHandler = app.connect("notify::monitors", () => rebuildWindows())
}

export function unregisterWindows(): void {
  if (monitorHandler !== null) app.disconnect(monitorHandler)
  monitorHandler = null
  destroyWindows()
}
