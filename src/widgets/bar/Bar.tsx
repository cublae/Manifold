import Gdk from "gi://Gdk?version=4.0"
import { Astal, Gtk } from "ags/gtk4"
import app from "ags/gtk4/app"

import { config, type ManifoldConfig } from "../../config"
import { barAnchor, barOrientation, isVertical, positionClass } from "../../lib/barLayout"
import { WindowName } from "../names"
import { buildModules, type BarModuleContext } from "./registry"

/**
 * The panel.
 *
 * One Bar instance exists per monitor. Layout comes from `bar.modules`, so the
 * three sections are built generically -- this file knows nothing about any
 * individual module.
 *
 * Position handling is deliberately thin here: everything that follows from
 * where the bar sits lives in lib/barLayout, and modules receive the position
 * through their context rather than reading config themselves.
 */

export interface BarProps {
  monitor: Gdk.Monitor
}

/**
 * Compose the three sections.
 *
 * `Gtk.CenterBox` is built imperatively rather than through JSX: it is a plain
 * GTK4 widget with `start`/`center`/`end` child slots rather than a normal
 * child list, so assigning the slots directly is clearer than fighting the
 * JSX child protocol.
 */
/**
 * The layout this output should use.
 *
 * `bar.outputs` overrides one section at a time, so a screen that wants the
 * clock somewhere else does not have to restate the other two.
 */
function layoutFor(
  cfg: ManifoldConfig,
  output: string | null,
): ManifoldConfig["bar"]["modules"] {
  // A monitor with no connector name matches no override, which is the same
  // answer as having none.
  const override = output ? cfg.bar.outputs?.[output] : undefined
  if (!override) return cfg.bar.modules

  return {
    start: override.start ?? cfg.bar.modules.start,
    center: override.center ?? cfg.bar.modules.center,
    end: override.end ?? cfg.bar.modules.end,
  }
}

function sections(cfg: ManifoldConfig, context: BarModuleContext): Gtk.Widget {
  const vertical = isVertical(cfg.bar.position)
  const orientation = barOrientation(cfg.bar.position)
  const modules = layoutFor(cfg, context.output)

  const centerBox = new Gtk.CenterBox({
    orientation,
    hexpand: !vertical,
    vexpand: vertical,
  })

  const section = (ids: ManifoldConfig["bar"]["modules"]["start"], align: Gtk.Align) => {
    const box = new Gtk.Box({
      orientation,
      spacing: 2,
      // Align along the bar's own axis; centre on the other one. Without the
      // cross-axis centring, children stretch to the full bar thickness and
      // their backgrounds (the focused-workspace pill, for one) touch both
      // edges.
      halign: vertical ? Gtk.Align.CENTER : align,
      valign: vertical ? align : Gtk.Align.CENTER,
      cssClasses: ["manifold-bar-section"],
    })
    for (const widget of buildModules(ids, context)) box.append(widget)
    return box
  }

  centerBox.set_start_widget(section(modules.start, Gtk.Align.START))
  centerBox.set_center_widget(section(modules.center, Gtk.Align.CENTER))
  centerBox.set_end_widget(section(modules.end, Gtk.Align.END))

  return centerBox
}

export default function Bar({ monitor }: BarProps): Astal.Window {
  const cfg = config.get()
  const output = monitor.get_connector()
  const { position, size } = cfg.bar
  const vertical = isVertical(position)

  const panel = new Gtk.Box({
    orientation: barOrientation(position),
    cssClasses: ["manifold-bar-panel", "manifold-root", positionClass(position)],
    // Thickness on the cross axis; the main axis is stretched by the anchors.
    heightRequest: vertical ? -1 : size,
    widthRequest: vertical ? size : -1,
    hexpand: !vertical,
    vexpand: vertical,
  })
  panel.append(sections(cfg, { output, position }))

  return (
    <window
      name={WindowName.bar(output)}
      namespace="manifold-bar"
      cssClasses={["manifold-window", "manifold-bar", positionClass(position)]}
      application={app}
      gdkmonitor={monitor}
      anchor={barAnchor(position)}
      // EXCLUSIVE reserves screen space, so niri tiles windows beside the bar
      // rather than behind it.
      exclusivity={Astal.Exclusivity.EXCLUSIVE}
      layer={Astal.Layer.TOP}
      visible
    >
      {panel}
    </window>
  ) as Astal.Window
}
