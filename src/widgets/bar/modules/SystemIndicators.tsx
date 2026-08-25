import { Gtk } from "ags/gtk4"
import { createComputed, createBinding, type Accessor } from "ags"
import { _ } from "../../../lib/i18n"

import * as system from "../../../services/system"
import BatteryService from "../../../services/battery"
import { clamp } from "../../../lib/utils"
import { captureScope } from "../../../lib/scope"
import { WindowName, togglePopup } from "../../names"
import { moduleOrientation } from "../../../lib/barLayout"
import type { BarPosition } from "../../../config"

/**
 * Network / audio / battery indicators, as one click target.
 *
 * GNOME treats the status icons as a single button that opens quick settings
 * rather than as individually clickable icons, so this is one button wrapping
 * the icon row.
 *
 * The optional indicators resolve asynchronously, which puts their widget
 * construction outside the reactive scope; `inScope` puts it back.
 */

type InScope = <T>(fn: () => T) => T

/** Map a volume level onto the standard symbolic icon ramp. */
function volumeIcon(volume: number, muted: boolean): string {
  if (muted || volume <= 0) return "audio-volume-muted-symbolic"
  const level = clamp(volume, 0, 1)
  if (level < 0.34) return "audio-volume-low-symbolic"
  if (level < 0.67) return "audio-volume-medium-symbolic"
  return "audio-volume-high-symbolic"
}

/** An icon driven by a derived {icon, tooltip} state. */
function Indicator(state: Accessor<{ icon: string; tooltip: string }>): Gtk.Widget {
  return (
    <image iconName={state((s) => s.icon)} tooltipText={state((s) => s.tooltip)} />
  ) as Gtk.Widget
}

async function NetworkIndicator(inScope: InScope): Promise<Gtk.Widget | null> {
  const network = await system.network()
  const Primary = await system.networkPrimary()
  if (!network || !Primary) return null

  const state = createComputed(
    [createBinding(network, "primary"), createBinding(network, "connectivity")],
    (primary) => {
      if (primary === Primary.WIRED && network.wired) {
        return { icon: network.wired.iconName, tooltip: "Wired" }
      }
      if (primary === Primary.WIFI && network.wifi) {
        const { ssid, strength, iconName } = network.wifi
        return { icon: iconName, tooltip: ssid ? `${ssid} · ${strength}%` : "Wi-Fi" }
      }
      return { icon: "network-offline-symbolic", tooltip: "Offline" }
    },
  )

  return inScope(() => Indicator(state))
}

async function AudioIndicator(inScope: InScope): Promise<Gtk.Widget | null> {
  const speaker = await system.speaker()
  if (!speaker) return null

  const state = createComputed(
    [createBinding(speaker, "volume"), createBinding(speaker, "mute")],
    (volume, mute) => ({
      icon: volumeIcon(volume, mute),
      tooltip: mute ? "Muted" : `${Math.round(volume * 100)}%`,
    }),
  )

  return inScope(() => Indicator(state))
}

/**
 * Battery.
 *
 * Needs no dynamic import: the battery service picks its own backend (UPower,
 * or sysfs when the daemon is absent) and flips `available` once it knows. The
 * icon is created up front and stays hidden until then.
 */
function BatteryIndicator(): Gtk.Widget {
  const battery = BatteryService.get_default()

  const tooltip = createComputed(
    [createBinding(battery, "percentage"), createBinding(battery, "state")],
    (percentage, state) => {
      const level = `${Math.round(percentage * 100)}%`
      if (state === "charging") return `${level} · charging`
      if (state === "not-charging") return `${level} · plugged in`
      if (state === "full") return `${level} · full`
      return level
    },
  )

  return (
    <image
      iconName={createBinding(battery, "iconName")}
      visible={createBinding(battery, "available")}
      tooltipText={tooltip}
    />
  ) as Gtk.Widget
}

export default function SystemIndicators({ position }: { position: BarPosition }): Gtk.Widget {
  const inScope = captureScope()

  const icons = new Gtk.Box({
    orientation: moduleOrientation(position),
    valign: Gtk.Align.CENTER,
    cssClasses: ["manifold-indicators"],
  })

  const button = new Gtk.Button({
    cssClasses: ["manifold-module", "manifold-indicators-button"],
    tooltipText: _("Control center"),
    valign: Gtk.Align.CENTER,
    child: icons,
  })
  button.connect("clicked", () => togglePopup(WindowName.ControlCenter))

  // Battery is synchronous, so it is appended first and keeps a stable slot;
  // the async ones fill in ahead of it as they resolve.
  const battery = BatteryIndicator()

  void (async () => {
    for (const make of [NetworkIndicator, AudioIndicator]) {
      const widget = await make(inScope)
      if (widget) icons.append(widget)
    }
    icons.append(battery)
  })()

  return button
}
