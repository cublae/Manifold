import Gdk from "gi://Gdk?version=4.0"
import GLib from "gi://GLib"
import { Astal, Gtk } from "ags/gtk4"
import app from "ags/gtk4/app"
import { timeout } from "ags/time"
import type AstalIO from "gi://AstalIO"

import * as system from "../../services/system"
import Niri from "../../services/niri"
import { config } from "../../config"
import { animationDuration, fade } from "../../lib/animation"
import { clamp } from "../../lib/utils"
import { onOsd } from "./bus"

/**
 * Volume and brightness overlay.
 *
 * Shown on change and hidden again after a delay. The subtlety is the *first*
 * change: subscribing to a property fires an initial callback with the current
 * value, which would flash the OSD at startup. Each source therefore ignores
 * its first notification.
 */

function anchorFor(position: string): Astal.WindowAnchor {
  if (position === "top") return Astal.WindowAnchor.TOP
  if (position === "center") return Astal.WindowAnchor.NONE
  return Astal.WindowAnchor.BOTTOM
}

export default function Osd(monitor: Gdk.Monitor): Astal.Window {
  const cfg = config.get()

  const icon = new Gtk.Image({ pixelSize: 24 })

  // Stands in for the icon when the thing being shown *is* a colour. Sized to
  // the icon so the panel keeps its shape either way.
  const swatch = new Gtk.Box({
    cssClasses: ["manifold-osd-swatch"],
    widthRequest: 24,
    heightRequest: 24,
    visible: false,
  })
  let swatchStyle: Gtk.CssProvider | null = null

  const bar = new Gtk.LevelBar({
    minValue: 0,
    maxValue: 1,
    hexpand: true,
    widthRequest: 180,
    cssClasses: ["manifold-osd-bar"],
  })
  const value = new Gtk.Label({ cssClasses: ["manifold-osd-value"], widthChars: 4 })

  const panel = new Gtk.Box({
    orientation: Gtk.Orientation.HORIZONTAL,
    spacing: 12,
    cssClasses: ["manifold-panel", "manifold-root", "manifold-osd"],
  })
  panel.append(icon)
  panel.append(swatch)
  panel.append(bar)
  panel.append(value)

  // The overlay fades rather than slides: it appears in the middle of what the
  // user is looking at, and movement there is a distraction.
  const reveal = new Gtk.Revealer({
    child: panel,
    transitionType: fade(),
    transitionDuration: animationDuration(),
    revealChild: false,
    halign: Gtk.Align.CENTER,
    valign: cfg.osd.position === "top" ? Gtk.Align.START : Gtk.Align.END,
  })

  const window = (
    <window
      name="osd"
      namespace="manifold-osd"
      cssClasses={["manifold-window"]}
      application={app}
      gdkmonitor={monitor}
      anchor={anchorFor(cfg.osd.position)}
      // Respects the bar's exclusive zone: anchored to the same edge as the
      // bar, an overlay that ignored it would sit on top of the bar itself.
      exclusivity={Astal.Exclusivity.NORMAL}
      layer={Astal.Layer.OVERLAY}
      keymode={Astal.Keymode.NONE}
      visible={false}
    >
      {reveal}
    </window>
  ) as Astal.Window

  let hideTimer: AstalIO.Time | null = null
  let unmapTimer: number | null = null

  /**
   * Bring the overlay up.
   *
   * A `level` gives the bar-and-percentage form used by volume and brightness;
   * a `text` gives the plain form used by the keyboard layout, which has no
   * scale to show and a name to read instead.
   */
  function show(
    iconName: string,
    reading: { level: number } | { text: string },
    swatchColor?: string,
  ): void {
    if (swatchColor) {
      // A fresh provider each time: a colour is not known until it is picked,
      // so there is no stylesheet rule to toggle, and swapping the old one out
      // keeps exactly one attached.
      if (swatchStyle) swatch.get_style_context().remove_provider(swatchStyle)
      swatchStyle = new Gtk.CssProvider()
      swatchStyle.load_from_string(`* { background-color: ${swatchColor}; }`)
      swatch.get_style_context().add_provider(swatchStyle, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)
    }

    icon.set_visible(!swatchColor)
    swatch.set_visible(Boolean(swatchColor))
    icon.set_from_icon_name(iconName)

    if ("level" in reading) {
      bar.set_visible(true)
      bar.set_value(clamp(reading.level, 0, 1))
      value.set_width_chars(4)
      value.set_label(`${Math.round(reading.level * 100)}`)
    } else {
      bar.set_visible(false)
      value.set_width_chars(0)
      value.set_label(reading.text)
    }

    if (unmapTimer !== null) {
      GLib.source_remove(unmapTimer)
      unmapTimer = null
    }

    window.visible = true
    // A frame later, so the fade has something to fade from.
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      reveal.reveal_child = true
      return GLib.SOURCE_REMOVE
    })

    hideTimer?.cancel()
    hideTimer = timeout(Math.max(200, config.get().osd.timeout), () => {
      hideTimer = null
      reveal.reveal_child = false

      const duration = animationDuration()
      if (duration === 0) {
        window.visible = false
        return
      }

      // Stay mapped until the fade is over, or it blinks out instead.
      unmapTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, duration, () => {
        unmapTimer = null
        if (!reveal.reveal_child) window.visible = false
        return GLib.SOURCE_REMOVE
      })
    })
  }

  function volumeIcon(volume: number, muted: boolean): string {
    if (muted || volume <= 0) return "audio-volume-muted-symbolic"
    if (volume < 0.34) return "audio-volume-low-symbolic"
    if (volume < 0.67) return "audio-volume-medium-symbolic"
    return "audio-volume-high-symbolic"
  }

  // Anything in the shell that has something to say goes through the bus; the
  // sources below are the ones this window watches for itself.
  const unsubscribe = onOsd((message) => show(message.icon, message.reading, message.swatch))

  void (async () => {
    const speaker = await system.speaker()
    if (speaker) {
      let primed = false
      const onChange = () => {
        // Skip the initial callback so the OSD does not flash on startup.
        if (!primed) {
          primed = true
          return
        }
        show(volumeIcon(speaker.volume, speaker.mute), {
          level: speaker.mute ? 0 : speaker.volume,
        })
      }
      speaker.connect("notify::volume", onChange)
      speaker.connect("notify::mute", onChange)
      primed = true
    }

    const backlight = await system.backlight()
    if (backlight) {
      let primed = true
      backlight.connect("notify::brightness", () => {
        if (!primed) {
          primed = true
          return
        }
        show("display-brightness-symbolic", { level: backlight.brightness })
      })
    }

    // -- microphone --------------------------------------------------------
    const microphone = await system.microphone()
    if (microphone) {
      let primed = false
      const onChange = () => {
        if (!primed) {
          primed = true
          return
        }
        show(
          microphone.mute || microphone.volume <= 0
            ? "microphone-disabled-symbolic"
            : "audio-input-microphone-symbolic",
          { level: microphone.mute ? 0 : microphone.volume },
        )
      }
      microphone.connect("notify::volume", onChange)
      microphone.connect("notify::mute", onChange)
      primed = true
    }

    // -- keyboard layout ---------------------------------------------------
    // Only where there is more than one to switch between; on a single-layout
    // setup the overlay would announce something that never changes.
    const niri = Niri.get_default()
    let primedLayout = false
    niri.connect("notify::keyboard-layout", () => {
      if (!primedLayout) {
        primedLayout = true
        return
      }
      if (niri.keyboardLayouts.names.length < 2) return
      show("input-keyboard-symbolic", { text: niri.keyboardLayout })
    })
  })()

  window.connect("destroy", () => {
    unsubscribe()
    hideTimer?.cancel()
    if (unmapTimer !== null) GLib.source_remove(unmapTimer)
  })
  return window
}
