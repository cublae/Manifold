import app from "ags/gtk4/app"
import type { Astal } from "ags/gtk4"

import {
  isWindowOpen,
  setWindowVisible,
  toggleWindow,
} from "./common/popupVisibility"

/**
 * Window names and dropdown behaviour.
 *
 * Deliberately separate from `windows.ts`: that module constructs the windows
 * and therefore imports every widget, while the widgets need the names in order
 * to toggle each other. Keeping the names here breaks what would otherwise be
 * an import cycle between the registry and the modules it builds.
 */

export const WindowName = {
  /** Bars are per-monitor, so their names carry the connector. */
  bar: (output: string | null) => `bar-${output ?? "unknown"}`,
  Calendar: "calendar",
  ControlCenter: "control-center",
  Launcher: "launcher",
  Clipboard: "clipboard",
  NotificationCenter: "notification-center",
  Weather: "weather",
  Osd: "osd",
} as const

/**
 * Windows that behave as dropdowns: at most one may be open at a time.
 *
 * Names for modules that are not implemented yet are listed on purpose -- the
 * exclusion rule should already hold the day they are added.
 */
export const POPUPS: string[] = [
  WindowName.Calendar,
  WindowName.ControlCenter,
  WindowName.Launcher,
  WindowName.Clipboard,
  WindowName.NotificationCenter,
  WindowName.Weather,
]

/**
 * Look a window up without complaining when it does not exist.
 *
 * `app.get_window` logs a CRITICAL for unknown names, which is noise given that
 * `POPUPS` intentionally lists windows that are not built yet.
 */
export function findWindow(name: string): Astal.Window | null {
  return (app.get_windows() as Astal.Window[]).find((w) => w.name === name) ?? null
}

/**
 * Toggle a dropdown, closing any other that is open.
 *
 * Bar modules and the IPC handler both go through this rather than
 * `app.toggle_window`, so opening the calendar while quick settings are up
 * swaps them instead of stacking two click-catching surfaces on each other.
 */
export function togglePopup(name: string): void {
  for (const window of app.get_windows() as Astal.Window[]) {
    if (window.name !== name && POPUPS.includes(window.name) && isWindowOpen(window)) {
      setWindowVisible(window, false)
    }
  }

  const target = findWindow(name)
  if (!target) {
    console.error(`manifold: no window named "${name}" is registered`)
    return
  }
  toggleWindow(target)
}
