import { Gtk } from "ags/gtk4"

import type { BarModuleId, BarPosition } from "../../config"
import Clock from "./modules/Clock"
import ControlCenterButton from "./modules/ControlCenterButton"
import FocusedWindow from "./modules/FocusedWindow"
import KeyboardLayout from "./modules/KeyboardLayout"
import SystemIndicators from "./modules/SystemIndicators"
import ClipboardButton from "./modules/ClipboardButton"
import LauncherButton from "./modules/LauncherButton"
import Media from "./modules/Media"
import Notifications from "./modules/Notifications"
import Privacy from "./modules/Privacy"
import Recording from "./modules/Recording"
import Resources from "./modules/Resources"
import Screencast from "./modules/Screencast"
import Tray from "./modules/Tray"
import Weather from "./modules/Weather"
import Workspaces from "./modules/Workspaces"

/** Context handed to every bar module at construction. */
export interface BarModuleContext {
  /** Connector name of the monitor the bar is on, e.g. "eDP-1". */
  output: string | null
  /** Where the bar sits, so modules can lay themselves out to match. */
  position: BarPosition
}

export type BarModuleFactory = (context: BarModuleContext) => Gtk.Widget

/**
 * Maps the module ids accepted in `bar.modules.*` onto their implementations.
 *
 * Adding a bar module means adding one entry here and one id to `BarModuleId`
 * in the config schema -- nothing in `Bar.tsx` needs to change.
 */
export const barModules: Record<BarModuleId, BarModuleFactory> = {
  workspaces: ({ output, position }) => Workspaces({ output, position }),
  "focused-window": (({ position }) => FocusedWindow({ position })),
  clock: ({ position }) => Clock({ position }),
  "keyboard-layout": () => KeyboardLayout(),
  "system-indicators": ({ position }) => SystemIndicators({ position }),
  tray: ({ position }) => Tray({ position }),
  notifications: () => Notifications(),
  launcher: () => LauncherButton(),
  clipboard: () => ClipboardButton(),
  "control-center": () => ControlCenterButton(),
  media: ({ position }) => Media({ position }),
  recording: () => Recording(),
  screencast: () => Screencast(),
  privacy: () => Privacy(),
  resources: () => Resources(),
  weather: ({ position }) => Weather({ position }),
  // An invisible expander, for pushing modules apart inside a section.
  spacer: ({ position }) =>
    new Gtk.Box(
      position === "left" || position === "right"
        ? { vexpand: true }
        : { hexpand: true },
    ),
}

/** Instantiate a module list, skipping ids that are not registered. */
export function buildModules(ids: BarModuleId[], context: BarModuleContext): Gtk.Widget[] {
  const widgets: Gtk.Widget[] = []

  for (const id of ids) {
    const factory = barModules[id]
    if (!factory) {
      console.error(`manifold: unknown bar module "${id}", skipping`)
      continue
    }
    try {
      widgets.push(factory(context))
    } catch (error) {
      console.error(`manifold: bar module "${id}" failed to build: ${error}`)
    }
  }

  return widgets
}
