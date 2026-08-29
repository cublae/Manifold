import { Astal, Gtk } from "ags/gtk4"
import { _ } from "../../lib/i18n"
import { createBinding, createComputed, createState } from "ags"

import * as system from "../../services/system"
import { pickColor } from "../../services/colorPicker"
import * as mihomo from "../../services/mihomo"
import { config } from "../../config"
import BatteryService from "../../services/battery"
import Recorder from "../../services/recorder"
import Niri from "../../services/niri"
import { animationDuration, animationsEnabled } from "../../lib/animation"
import { bellIcon, firstIcon } from "../../lib/icons"
import { clamp } from "../../lib/utils"
import { captureScope } from "../../lib/scope"
import { focusAgain, focusFirst } from "../common/focus"
import { editing, toggleEditingDesktop } from "../desktop/edit"
import { PopupWindow } from "../common/PopupWindow"
import { setWindowVisible } from "../common/popupVisibility"
import { WindowName, togglePopup } from "../names"
import BluetoothPage from "./BluetoothPage"
import FatSlider from "./FatSlider"
import MediaCard from "./MediaCard"
import MixerPage from "./MixerPage"
import SessionPage from "./SessionPage"
import NetworkPage from "./NetworkPage"
import ProxyPage from "./ProxyPage"
import QuickTile from "./QuickTile"

/**
 * Quick settings.
 *
 * A two-column grid of tiles over a pair of sliders and a now-playing card.
 * Tiles that have more to show carry a chevron opening a detail page, and those
 * pages replace the panel rather than expanding inside it -- a list unfolding
 * in place would shove everything below it around as entries come and go.
 *
 * Every tile is built from a service that may be absent, so each one hides
 * itself rather than showing a control that cannot do anything.
 */

type InScope = <T>(fn: () => T) => T

function volumeIcon(volume: number, muted: boolean): string {
  if (muted || volume <= 0) return "audio-volume-muted-symbolic"
  const level = clamp(volume, 0, 1)
  if (level < 0.34) return "audio-volume-low-symbolic"
  if (level < 0.67) return "audio-volume-medium-symbolic"
  return "audio-volume-high-symbolic"
}

function elapsed(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`
}

/**
 * Open the control center on a given page.
 *
 * Exposed so a keybinding can go straight to the Wi-Fi list instead of landing
 * on the main panel and needing a second click. Null until the panel is built,
 * which is why the IPC handler reports rather than assumes success.
 */
let showPage: ((page: string) => void) | null = null

export function openControlCenterPage(page: string): boolean {
  if (!showPage) return false
  showPage(page)
  return true
}

// -- tiles ------------------------------------------------------------------

async function InternetTile(inScope: InScope, expand: () => void): Promise<Gtk.Widget | null> {
  const network = await system.network()
  const Primary = await system.networkPrimary()
  if (!network || !Primary) return null

  const state = createComputed(
    [createBinding(network, "primary"), createBinding(network, "connectivity")],
    (primary) => {
      if (primary === Primary.WIRED && network.wired) {
        return { icon: "network-wired-symbolic", name: _("Wired"), on: true }
      }
      if (primary === Primary.WIFI && network.wifi) {
        const { ssid, enabled, iconName } = network.wifi
        return { icon: iconName, name: enabled ? (ssid ?? _("Not connected")) : _("Off"), on: enabled }
      }
      return { icon: "network-offline-symbolic", name: _("Offline"), on: false }
    },
  )

  return inScope(() =>
    QuickTile({
      icon: state((s) => s.icon),
      label: _("Internet"),
      subtitle: state((s) => s.name),
      active: state((s) => s.on),
      onClicked: () => {
        const wifi = network.wifi
        if (!wifi) return
        wifi.enabled = !wifi.enabled
        if (wifi.enabled) wifi.scan()
      },
      onExpand: expand,
    }),
  )
}

async function BluetoothTile(inScope: InScope, expand: () => void): Promise<Gtk.Widget | null> {
  const bluetooth = await system.bluetooth()
  if (!bluetooth || !bluetooth.adapter) return null

  const state = createComputed(
    [
      createBinding(bluetooth, "isPowered"),
      createBinding(bluetooth, "isConnected"),
      createBinding(bluetooth, "devices"),
    ],
    (powered, connected, devices) => {
      if (!powered) return { on: false, name: _("Off") }
      const active = devices.find((device) => device.connected)
      return { on: true, name: connected && active ? (active.alias || active.name) : _("On") }
    },
  )

  return inScope(() =>
    QuickTile({
      icon: state((s) => (s.on ? "bluetooth-active-symbolic" : "bluetooth-disabled-symbolic")),
      label: _("Bluetooth"),
      subtitle: state((s) => s.name),
      active: state((s) => s.on),
      onClicked: () => bluetooth.toggle(),
      onExpand: expand,
    }),
  )
}

async function PowerTile(inScope: InScope): Promise<Gtk.Widget | null> {
  const profiles = await system.powerProfiles()
  if (!profiles) return null

  const names = profiles.get_profiles().map((profile) => profile.profile)
  if (names.length === 0) return null

  const active = createBinding(profiles, "activeProfile")

  return inScope(() =>
    QuickTile({
      icon: createBinding(profiles, "iconName").as(
        (icon) => icon || "power-profile-balanced-symbolic",
      ),
      label: _("Power"),
      // The daemon names its profiles in English; they are user-visible, so
      // they go through the catalogue like anything else.
      subtitle: active.as((profile) => _(profile.replace("-", " "))),
      // Only "performance" is worth accenting; balanced is the resting state.
      active: active.as((profile) => profile === "performance"),
      onClicked: () => {
        const index = names.indexOf(profiles.activeProfile)
        profiles.activeProfile = names[(index + 1) % names.length]!
      },
    }),
  )
}

/**
 * The mihomo proxy core.
 *
 * Absent unless its front-end is installed, which is what the config file
 * standing there means. Clicking moves between routing by rules and letting
 * everything past the proxy -- the two states worth a single click -- and the
 * chevron opens the node picker.
 */
async function ProxyTile(inScope: InScope, expand: () => void): Promise<Gtk.Widget | null> {
  if (!config.get().modules.proxy) return null

  await mihomo.refresh()
  if (!mihomo.state.get().configured) return null

  const tile = inScope(() =>
    QuickTile({
      icon: mihomo.state.as((s) =>
        s.running && s.mode !== "direct" ? "network-vpn-symbolic" : "network-vpn-disabled-symbolic",
      ),
      label: _("Proxy"),
      subtitle: mihomo.state.as((s) => {
        if (!s.running) return _("Off")
        if (s.mode === "direct") return _("Direct")
        return mihomo.currentNode(s) || _(s.mode === "global" ? "Global" : "Rules")
      }),
      active: mihomo.state.as((s) => s.running && s.mode !== "direct"),
      onClicked: () => {
        const current = mihomo.state.get()
        if (!current.running) return
        void mihomo.setMode(current.mode === "direct" ? "rule" : "direct")
      },
      onExpand: expand,
    }),
  )

  // Polled only while the panel is on screen. The tile is unmapped with it, so
  // its own mapping is the signal -- no need for the window to tell anyone.
  let stop: (() => void) | null = null
  tile.connect("map", () => {
    stop ??= mihomo.poll()
  })
  tile.connect("unmap", () => {
    stop?.()
    stop = null
  })

  return tile
}

function RecordTile(inScope: InScope): Gtk.Widget | null {
  const recorder = Recorder.get_default()
  if (!recorder.available) return null

  return inScope(() => QuickTile({
    icon: createBinding(recorder, "recording").as((on) =>
      on ? "media-record-symbolic" : "camera-video-symbolic",
    ),
    label: _("Screen Record"),
    subtitle: createComputed(
      [createBinding(recorder, "recording"), createBinding(recorder, "elapsed")],
      (on, seconds) => (on ? elapsed(seconds) : _("Off")),
    ),
    active: createBinding(recorder, "recording"),
    onClicked: () => recorder.toggle(),
  }))
}

async function NotificationsTile(inScope: InScope): Promise<Gtk.Widget | null> {
  const notifd = await system.notifd()
  if (!notifd) return null

  const [count, setCount] = createState(notifd.notifications.length)
  const sync = () => setCount(notifd.notifications.length)
  notifd.connect("notified", sync)
  notifd.connect("resolved", sync)

  const quiet = createBinding(notifd, "dontDisturb")

  return inScope(() =>
    QuickTile({
      icon: quiet.as((on) => bellIcon(on)),
      label: _("Notifications"),
      subtitle: createComputed([count, quiet], (n, off) =>
        off ? _("Silenced") : n > 0 ? String(n) : _("None"),
      ),
      active: createComputed([count, quiet], (n, off) => !off && n > 0),
      onClicked: () => (notifd.dontDisturb = !notifd.dontDisturb),
      onExpand: () => togglePopup(WindowName.NotificationCenter),
    }),
  )
}

function ScreenshotTile(inScope: InScope): Gtk.Widget {
  const niri = Niri.get_default()
  const [busy] = createState(false)

  return inScope(() => QuickTile({
    icon: "camera-photo-symbolic",
    label: _("Screenshot"),
    subtitle: _("Region"),
    active: busy,
    // niri owns the interactive region picker; the shell only asks for it.
    onClicked: () => void niri.dispatch({ Screenshot: { show_pointer: false } }),
  }))
}

function ColorPickerTile(inScope: InScope, close: () => void): Gtk.Widget {
  const [busy] = createState(false)

  return inScope(() =>
    QuickTile({
      icon: firstIcon("color-select-symbolic", "gtk-color-picker", "applications-graphics-symbolic"),
      label: _("Pick colour"),
      subtitle: _("To clipboard"),
      active: busy,
      onClicked: () => {
        // The panel has to go first. niri's picker takes the pointer, and a
        // quick-settings panel sitting over the thing being sampled is the one
        // colour nobody wants.
        close()
        void pickColor()
      },
    }),
  )
}

/**
 * Arrange the desktop widgets.
 *
 * Only offered when there are widgets to arrange: with `desktop.enabled` off
 * the tile would turn on a mode with nothing in it.
 */
function DesktopTile(inScope: InScope, close: () => void): Gtk.Widget | null {
  if (!config.get().desktop.enabled) return null

  return inScope(() =>
    QuickTile({
      icon: firstIcon("view-grid-symbolic", "preferences-desktop-symbolic", "video-display-symbolic"),
      label: _("Desktop"),
      subtitle: editing((on) => (on ? _("Arranging") : _("Arrange"))),
      active: editing,
      onClicked: () => {
        const on = toggleEditingDesktop()
        // The panel covers the middle of the screen, which is where the
        // widgets are. It has to be out of the way to arrange them.
        if (on) close()
      },
    }),
  )
}

// -- header -----------------------------------------------------------------

function Header(): Gtk.Widget {
  const battery = BatteryService.get_default()

  const chip = (
    <box cssClasses={["manifold-battery-chip"]} spacing={6} visible={createBinding(battery, "available")}>
      <image iconName={createBinding(battery, "iconName")} pixelSize={16} />
      <label
        label={createBinding(battery, "percentage").as((value) => `${Math.round(value * 100)}%`)}
      />
    </box>
  ) as Gtk.Widget

  // One button rather than a pair: everything that ends the session lives on
  // its own page now, including the three actions the header had no room for.
  const power = (
    <button
      cssClasses={["manifold-round-button"]}
      tooltipText={_("Session")}
      onClicked={() => showPage?.("session")}
    >
      <image iconName="system-shutdown-symbolic" pixelSize={16} />
    </button>
  ) as Gtk.Widget

  const header = new Gtk.Box({
    orientation: Gtk.Orientation.HORIZONTAL,
    spacing: 6,
    cssClasses: ["manifold-cc-toprow"],
  })
  header.append(chip)
  header.append(new Gtk.Box({ hexpand: true }))
  header.append(power)

  return header
}

// -- panel ------------------------------------------------------------------

export default function ControlCenter(): Astal.Window {
  const inScope = captureScope()

  const grid = new Gtk.Grid({
    columnSpacing: 8,
    rowSpacing: 8,
    columnHomogeneous: true,
    // Equal rows as well as equal columns: one tile with a shorter subtitle
    // would otherwise leave its whole row shallower than the others.
    rowHomogeneous: true,
    cssClasses: ["manifold-tile-grid"],
  })

  const sliders = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 8,
    cssClasses: ["manifold-sliders"],
  })

  const main = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 12 })
  main.append(Header())
  main.append(grid)
  main.append(sliders)
  main.append(MediaCard())

  const stack = new Gtk.Stack({
    transitionType: animationsEnabled()
      ? Gtk.StackTransitionType.SLIDE_LEFT_RIGHT
      : Gtk.StackTransitionType.NONE,
    transitionDuration: animationDuration(),
    // Pages differ in height; without this the panel is as tall as the tallest.
    vhomogeneous: false,
    interpolateSize: true,
  })

  /**
   * Show a page, keeping the panel the size the main page would be.
   *
   * A detail page is a list of whatever happens to be around -- streams,
   * networks, devices -- so its own height says nothing about how big the panel
   * should be, and letting it decide makes the panel jump every time something
   * appears. Pinning the stack to the main page's measurement -- taken now,
   * since it moves as tiles and the media card come and go -- keeps one size and
   * leaves the lists to scroll inside it. Measuring rather than reading the
   * allocation is what lets `manifold control-center wifi` open straight onto a
   * page, before the main one has ever been drawn.
   *
   * Focus travels with the page. Without that, opening the Wi-Fi list from the
   * keyboard would leave focus on a tile the stack has just slid off screen,
   * and every key after it would go nowhere.
   */
  let opener: Gtk.Widget | null = null

  const show = (name: string) => () => {
    if (name === "main") {
      stack.set_size_request(-1, -1)
      stack.set_visible_child_name(name)
      focusAgain(opener, grid)
      opener = null
      return
    }

    const [, natural] = main.measure(Gtk.Orientation.VERTICAL, -1)
    stack.set_size_request(-1, natural)
    // Remembered before the switch, while the chevron that was pressed is
    // still the focused widget.
    opener = stack.get_root()?.get_focus() ?? null
    stack.set_visible_child_name(name)
    focusFirst(stack.get_visible_child()!)
  }
  const back = show("main")

  stack.add_named(main, "main")
  stack.add_named(NetworkPage({ back }), "wifi")
  stack.add_named(ProxyPage({ back }), "proxy")
  stack.add_named(BluetoothPage({ back }), "bluetooth")
  stack.add_named(MixerPage({ back }), "mixer")
  stack.add_named(SessionPage({ back }), "session")
  stack.set_visible_child_name("main")

  showPage = (page: string) => {
    // Through the same helper, so a page opened from the command line is sized
    // the way it would be if the user had pressed the chevron.
    if (stack.get_child_by_name(page)) show(page)()
  }

  const content = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    cssClasses: ["manifold-popup-content"],
    widthRequest: 320,
  })
  content.append(stack)

  void (async () => {
    // Tiles fill the grid in a fixed order, so the panel does not reshuffle
    // between runs as services resolve at different speeds.
    const tiles: Array<Gtk.Widget | null> = [
      await InternetTile(inScope, show("wifi")),
      await BluetoothTile(inScope, show("bluetooth")),
      await ProxyTile(inScope, show("proxy")),
      await PowerTile(inScope),
      RecordTile(inScope),
      ScreenshotTile(inScope),
      ColorPickerTile(inScope, () => setWindowVisible(window, false)),
      DesktopTile(inScope, () => setWindowVisible(window, false)),
      await NotificationsTile(inScope),
    ]

    let slot = 0
    for (const tile of tiles) {
      if (!tile) continue
      grid.attach(tile, slot % 2, Math.floor(slot / 2), 1, 1)
      slot += 1
    }

    const speaker = await system.speaker()
    if (speaker) {
      const icon = createComputed(
        [createBinding(speaker, "volume"), createBinding(speaker, "mute")],
        (volume, mute) => volumeIcon(volume, mute),
      )

      // The slider keeps the full width it had; the chevron is a second press
      // target beside it, the same split the tiles use.
      const row = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 6,
        cssClasses: ["manifold-slider-row"],
      })

      row.append(
        inScope(() =>
          FatSlider({
            icon,
            value: createBinding(speaker, "volume"),
            onChange: (value) => {
              speaker.volume = value
              if (speaker.mute && value > 0) speaker.mute = false
            },
            tooltip: _("Volume"),
          }),
        ),
      )

      row.append(
        inScope(() => (
          <button
            cssClasses={["manifold-slider-expand"]}
            tooltipText={_("Volume mixer")}
            onClicked={show("mixer")}
          >
            <image iconName="go-next-symbolic" />
          </button>
        ) as Gtk.Widget),
      )

      sliders.append(row)
    }

    const microphone = await system.microphone()
    if (microphone) {
      const muted = createBinding(microphone, "mute")

      // Same split as the volume row: the slider keeps its width, the button
      // beside it is a second target -- here the mute, which used to live in
      // the bar and belongs next to the level it silences.
      const row = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 6,
        cssClasses: ["manifold-slider-row"],
      })

      row.append(
        inScope(() =>
          FatSlider({
            icon: createComputed([createBinding(microphone, "volume"), muted], (volume, mute) =>
              mute || volume <= 0
                ? "microphone-disabled-symbolic"
                : "audio-input-microphone-symbolic",
            ),
            value: createBinding(microphone, "volume"),
            onChange: (value) => {
              microphone.volume = value
              if (microphone.mute && value > 0) microphone.mute = false
            },
            tooltip: _("Microphone"),
          }),
        ),
      )

      row.append(
        inScope(() => (
          <button
            cssClasses={muted.as((mute) =>
              mute ? ["manifold-slider-expand", "active"] : ["manifold-slider-expand"],
            )}
            tooltipText={_("Mute microphone")}
            onClicked={() => (microphone.mute = !microphone.mute)}
          >
            <image
              iconName={muted.as((mute) =>
                mute ? "microphone-disabled-symbolic" : "audio-input-microphone-symbolic",
              )}
            />
          </button>
        ) as Gtk.Widget),
      )

      sliders.append(row)
    }

    const backlight = await system.backlight()
    if (backlight) {
      sliders.append(
        inScope(() =>
          FatSlider({
            icon: "display-brightness-symbolic",
            value: createBinding(backlight, "brightness"),
            onChange: (value) => backlight.set_brightness(clamp(value, 0.01, 1)),
            tooltip: _("Brightness"),
          }),
        ),
      )
    }

    sliders.set_visible(sliders.get_first_child() !== null)
  })()

  const window = PopupWindow({
    name: WindowName.ControlCenter,
    align: "end",
    cssClasses: ["manifold-control-center"],
    // The panel is a grid of buttons and a stack of pages, which is exactly
    // the kind of thing worth driving from the keyboard: the tiles take focus
    // in order, arrows walk the grid, Enter presses.
    keyboard: true,
    // Escape means "back" while a page is open, and only closes the panel from
    // the main one -- the same way it behaves everywhere else with a stack.
    onEscape: () => {
      if (stack.get_visible_child_name() === "main") return false
      back()
      return true
    },
    child: content,
  })

  // Always reopen on the main page: a panel that remembers it was left in the
  // Bluetooth list is disorienting the next time it is summoned.
  //
  // On the way in, focus lands on the first tile -- the grid rather than the
  // panel, so it skips the header and the first arrow press moves instead of
  // merely revealing where focus had been hiding.
  window.connect("notify::visible", () => {
    if (window.visible) {
      opener = null
      focusFirst(grid)
    } else {
      stack.set_visible_child_name("main")
      stack.set_size_request(-1, -1)
    }
  })

  return window
}
