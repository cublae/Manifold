import { Gtk } from "ags/gtk4"
import { For, createBinding, createComputed, createState } from "ags"
import type AstalBluetoothNS from "gi://AstalBluetooth"
import { _ } from "../../lib/i18n"

import * as system from "../../services/system"
import { captureScope } from "../../lib/scope"

/**
 * Bluetooth device list.
 *
 * Discovery is started when the page opens and stopped when it closes: leaving
 * an adapter scanning costs power and floods the list with every passing
 * device, and there is nothing to discover while the page is not on screen.
 */

interface Item {
  address: string
  name: string
  icon: string
  connected: boolean
  connecting: boolean
  paired: boolean
  battery: number
  device: AstalBluetoothNS.Device
}

/**
 * The device's real name, or null when it has not given one.
 *
 * BlueZ always answers `Alias`: with no name to go on it hands back the address
 * with dashes for colons, which is why an unfiltered list reads as a column of
 * MAC addresses. Comparing against that shape is the only way to tell a name
 * from a placeholder -- the property itself gives no hint.
 */
function deviceName(device: AstalBluetoothNS.Device): string | null {
  const placeholder = (device.address ?? "").replaceAll(":", "-").toUpperCase()

  for (const candidate of [device.alias, device.name]) {
    const value = candidate?.trim()
    if (value && value.toUpperCase() !== placeholder) return value
  }

  return null
}

export interface BluetoothPageProps {
  back: () => void
}

export default function BluetoothPage({ back }: BluetoothPageProps): Gtk.Widget {
  const inScope = captureScope()

  const page = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 10,
    cssClasses: ["manifold-cc-page"],
  })

  void (async () => {
    const bluetooth = await system.bluetooth()
    const adapter = bluetooth?.adapter
    if (!bluetooth || !adapter) {
      page.append(
        inScope(() => (<label cssClasses={["dim"]} label={_("No Bluetooth adapter")} />) as Gtk.Widget),
      )
      return
    }

    const header = inScope(
      () =>
        (
          <box cssClasses={["manifold-cc-header"]} spacing={6}>
            <button cssClasses={["manifold-module"]} tooltipText={_("Back")} onClicked={back}>
              <image iconName="go-previous-symbolic" />
            </button>
            <label cssClasses={["title"]} hexpand halign={Gtk.Align.START} label={_("Bluetooth")} />
            <image
              cssClasses={["dim"]}
              iconName="view-refresh-symbolic"
              tooltipText={_("Scanning")}
              visible={createBinding(adapter, "discovering")}
            />
            <switch
              active={createBinding(bluetooth, "isPowered")}
              onNotifyActive={(self: Gtk.Switch) => {
                if (self.active !== bluetooth.isPowered) adapter.powered = self.active
              }}
            />
          </box>
        ) as Gtk.Widget,
    )

    // The device list notifies only when a device appears or disappears, and
    // everything a row shows lives on the device itself: BlueZ resolves the
    // name a moment after discovery, and connection state and battery change
    // later still. So each device is watched once, and any of it bumps the
    // revision the list is computed from.
    const [revision, setRevision] = createState(0)
    const watched = new WeakSet<AstalBluetoothNS.Device>()
    const devices = createBinding(bluetooth, "devices")

    const WATCHED_PROPERTIES = [
      "alias",
      "name",
      "connected",
      "connecting",
      "paired",
      "battery-percentage",
    ]

    function watch(list: AstalBluetoothNS.Device[]): void {
      for (const device of list) {
        if (watched.has(device)) continue
        watched.add(device)

        for (const property of WATCHED_PROPERTIES) {
          device.connect(`notify::${property}`, () => setRevision(revision.get() + 1))
        }
      }
    }

    watch(devices.get())
    inScope(() => devices.subscribe(() => watch(devices.get())))

    const items = createComputed([devices, revision], (list): Item[] =>
      list
        // A device that has not announced a name is a passing phone or a beacon
        // and only clutters the list. One that is paired or connected stays
        // whatever it calls itself, or there would be no way to disconnect it.
        .filter((device) => deviceName(device) !== null || device.paired || device.connected)
        .map((device) => ({
          address: device.address,
          name: deviceName(device) ?? device.address,
          icon: device.icon || "bluetooth-symbolic",
          connected: device.connected,
          connecting: device.connecting,
          paired: device.paired,
          battery: device.batteryPercentage,
          device,
        }))
        // Connected first, then remembered devices, then everything else.
        .sort(
          (a, b) =>
            Number(b.connected) - Number(a.connected) || Number(b.paired) - Number(a.paired),
        ),
    )

    function onClicked(item: Item): void {
      const { device } = item

      if (item.connected) {
        device.disconnect_device(() => {})
        return
      }
      // An unpaired device has to be paired before it will accept a
      // connection; BlueZ handles the exchange from here.
      if (!item.paired) device.pair()
      device.connect_device(() => {})
    }

    const rows = inScope(
      () =>
        (
          <box orientation={Gtk.Orientation.VERTICAL} spacing={2}>
            <For
              each={items}
              id={(item: Item) =>
                // The name is part of the key on purpose: BlueZ reports the address
                // first and fills the name in a moment later, and a row keyed only on
                // the address would keep showing the placeholder.
                `${item.address}:${item.name}:${item.connected}:${item.connecting}:${item.paired}:${item.battery}`
              }
            >
              {(item: Item) => (
                <button
                  cssClasses={
                    item.connected ? ["manifold-device-row", "active"] : ["manifold-device-row"]
                  }
                  onClicked={() => onClicked(item)}
                >
                  <box spacing={10}>
                    <image iconName={item.icon} />
                    <box orientation={Gtk.Orientation.VERTICAL} hexpand valign={Gtk.Align.CENTER}>
                      <label
                        halign={Gtk.Align.START}
                        ellipsize={3}
                        maxWidthChars={16}
                        label={item.name}
                      />
                      <label
                        cssClasses={["description", "dim"]}
                        halign={Gtk.Align.START}
                        visible={item.connecting || item.battery > 0}
                        label={
                          item.connecting
                            ? _("Connecting…")
                            : `${Math.round(item.battery * 100)}%`
                        }
                      />
                    </box>
                    <image iconName="object-select-symbolic" visible={item.connected} />
                  </box>
                </button>
              )}
            </For>
          </box>
        ) as Gtk.Widget,
    )

    // Fills the height the control centre pins the page to; longer lists scroll.
    const scroller = new Gtk.ScrolledWindow({
      hscrollbarPolicy: Gtk.PolicyType.NEVER,
      vscrollbarPolicy: Gtk.PolicyType.AUTOMATIC,
      vexpand: true,
      child: rows,
    })

    // Exactly one of the two fills the page: the list when there is one, the
    // notice centred in its place when there is not, so the panel keeps the one
    // size either way.
    const nothingToShow = createComputed(
      [createBinding(bluetooth, "isPowered"), items],
      (powered, list) => !powered || list.length === 0,
    )

    const empty = inScope(
      () =>
        (
          <box
            orientation={Gtk.Orientation.VERTICAL}
            spacing={8}
            cssClasses={["manifold-device-empty", "dim"]}
            valign={Gtk.Align.CENTER}
            vexpand
            visible={nothingToShow}
          >
            <label
              label={createBinding(bluetooth, "isPowered").as((powered) =>
                powered ? _("Searching for devices…") : _("Turn on Bluetooth to see devices"),
              )}
            />
          </box>
        ) as Gtk.Widget,
    )

    const listArea = inScope(
      () =>
        (
          <box
            orientation={Gtk.Orientation.VERTICAL}
            vexpand
            visible={nothingToShow.as((nothing) => !nothing)}
          >
            {scroller}
          </box>
        ) as Gtk.Widget,
    )

    page.append(header)
    page.append(empty)
    page.append(listArea)

    // Discovery follows the page's visibility, not the panel's lifetime.
    page.connect("map", () => {
      if (bluetooth.isPowered && !adapter.discovering) adapter.start_discovery()
    })
    page.connect("unmap", () => {
      if (adapter.discovering) adapter.stop_discovery()
    })
  })()

  return page
}
