import Gdk from "gi://Gdk?version=4.0"
import GLib from "gi://GLib"
import { Gtk } from "ags/gtk4"
import { For, createBinding, createComputed, createState } from "ags"
import type AstalNetworkNS from "gi://AstalNetwork"
import type NMNS from "gi://NM"
import { _ } from "../../lib/i18n"

import * as system from "../../services/system"
import { addIcon } from "../../lib/icons"
import { captureScope } from "../../lib/scope"

/**
 * Wi-Fi network list.
 *
 * `AccessPoint.activate` does the whole job for joining: it brings up the first
 * saved connection for the network, or builds a new wpa-psk one from a
 * password. That is why there is no nmcli anywhere here -- the only thing
 * Manifold has to decide is whether to ask for a password first, which it does
 * by looking for an existing saved connection.
 *
 * Two things Astal does not cover are done through NetworkManager's own library
 * instead, which is the same library underneath rather than a new dependency:
 * forgetting a saved profile, and dialling an SSID that is never broadcast.
 */

interface Item {
  ssid: string
  strength: number
  icon: string
  active: boolean
  secured: boolean
  /** Has a saved profile, so it can be forgotten as well as joined. */
  saved: boolean
  ap: AstalNetworkNS.AccessPoint
}

/**
 * What the entry row at the top of the page is asking for.
 *
 * A hidden network needs a name as well as a secret, and a network that is on
 * the list already has its name from the list -- hence two shapes rather than
 * one form that is half empty most of the time.
 */
type Prompt =
  | { kind: "password"; ap: AstalNetworkNS.AccessPoint }
  | { kind: "hidden" }
  | null

/**
 * The network name a saved profile is for, or null if it is not a Wi-Fi one.
 *
 * NetworkManager stores an SSID as bytes rather than a string, since the
 * standard does not say it has to be text at all. Everything the user sees --
 * the scan list, this page -- treats it as UTF-8 anyway, so the two agree.
 */
function profileSsid(connection: NMNS.RemoteConnection): string | null {
  const wireless = connection.get_setting_wireless()
  const ssid = wireless?.get_ssid()
  if (!ssid) return null

  return new TextDecoder().decode(ssid.get_data() ?? new Uint8Array())
}

export interface NetworkPageProps {
  /** Return to the main quick-settings page. */
  back: () => void
}

export default function NetworkPage({ back }: NetworkPageProps): Gtk.Widget {
  const inScope = captureScope()

  const list = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 2,
    cssClasses: ["manifold-device-list"],
  })

  // Fills the height the control centre pins the page to; longer lists scroll.
  const scroller = new Gtk.ScrolledWindow({
    hscrollbarPolicy: Gtk.PolicyType.NEVER,
    vscrollbarPolicy: Gtk.PolicyType.AUTOMATIC,
    vexpand: true,
    child: list,
  })

  const page = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 10,
    cssClasses: ["manifold-cc-page"],
  })

  void (async () => {
    const network = await system.network()
    const wifi = network?.wifi
    if (!wifi) {
      page.append(
        inScope(() => (<label cssClasses={["dim"]} label={_("No Wi-Fi device")} />) as Gtk.Widget),
      )
      return
    }

    // -- saved profiles ------------------------------------------------------
    // Read from NetworkManager rather than through `AccessPoint.get_connections`:
    // that call asks NM to filter the whole profile list against one access
    // point, and doing it for every network on every scan tick makes NM log a
    // failed assertion each time. The names are all this page needs, and they
    // come straight off the client.
    const client = network?.client ?? null
    const [savedNames, setSavedNames] = createState<string[]>([])

    function refreshSaved(): void {
      const names = (client?.get_connections() ?? [])
        .map(profileSsid)
        .filter((name): name is string => name !== null)

      setSavedNames(names)
    }

    if (client) {
      client.connect("connection-added", refreshSaved)
      client.connect("connection-removed", refreshSaved)
    }
    refreshSaved()

    // -- password prompt ---------------------------------------------------
    // Kept at page level rather than inside a row: the list rebuilds whenever
    // signal strength shifts, which would tear a per-row entry out from under
    // the user mid-typing.
    const [pending, setPending] = createState<Prompt>(null)

    const ssidEntry = new Gtk.Entry({
      placeholderText: _("Network name"),
      hexpand: true,
      cssClasses: ["manifold-password-entry"],
    })

    const password = new Gtk.PasswordEntry({
      showPeekIcon: true,
      hexpand: true,
      cssClasses: ["manifold-password-entry"],
    })

    function dismiss(): void {
      setPending(null)
      password.set_text("")
      ssidEntry.set_text("")
    }

    function connect(ap: AstalNetworkNS.AccessPoint, secret: string | null): void {
      ap.activate(secret, (source, result) => {
        try {
          source?.activate_finish(result)
        } catch (error) {
          console.error(`manifold: could not join ${ap.ssid}: ${error}`)
        }
      })
      dismiss()
    }

    /**
     * Join a network that does not advertise itself.
     *
     * There is no access point to activate -- that is the whole point of a
     * hidden network -- so the profile is built here and handed to NM to add
     * and bring up in one call. `hidden` on the wireless setting is what makes
     * NM probe for the name rather than wait to see it in a scan.
     */
    async function connectHidden(ssid: string, secret: string): Promise<void> {
      const NM = await system.networkManager()
      const client = network?.client
      const device = wifi?.device
      if (!NM || !client || !device) return

      const profile = NM.SimpleConnection.new()
      profile.add_setting(new NM.SettingConnection({ id: ssid, type: "802-11-wireless" }))
      profile.add_setting(
        new NM.SettingWireless({
          ssid: new GLib.Bytes(new TextEncoder().encode(ssid)),
          hidden: true,
        }),
      )

      // An open hidden network is unusual but legal; adding an empty security
      // setting to one would make NM refuse the profile.
      if (secret) {
        profile.add_setting(new NM.SettingWirelessSecurity({ keyMgmt: "wpa-psk", psk: secret }))
      }

      client.add_and_activate_connection_async(profile, device, null, null, (source, result) => {
        try {
          source?.add_and_activate_connection_finish(result)
        } catch (error) {
          console.error(`manifold: could not join ${ssid}: ${error}`)
        }
      })
    }

    /** Delete every saved profile for a network, so it stops joining itself. */
    function forget(item: Item): void {
      for (const connection of client?.get_connections() ?? []) {
        if (profileSsid(connection) !== item.ssid) continue

        connection.delete_async(null, (source, result) => {
          try {
            source?.delete_finish(result)
          } catch (error) {
            console.error(`manifold: could not forget ${item.ssid}: ${error}`)
          }
        })
      }
    }

    /** Act on whichever prompt is up. */
    function submit(): void {
      const prompt = pending.get()
      if (!prompt) return

      if (prompt.kind === "password") {
        connect(prompt.ap, password.get_text())
        return
      }

      const ssid = ssidEntry.get_text().trim()
      if (!ssid) return

      void connectHidden(ssid, password.get_text())
      dismiss()
    }

    const prompt = inScope(
      () =>
        (
          <box
            orientation={Gtk.Orientation.VERTICAL}
            spacing={6}
            visible={pending((state) => state !== null)}
          >
            <box
              cssClasses={["manifold-password-prompt"]}
              spacing={6}
              visible={pending((state) => state?.kind === "hidden")}
            >
              {ssidEntry}
            </box>
            <box cssClasses={["manifold-password-prompt"]} spacing={6}>
              {password}
              <button cssClasses={["manifold-module"]} tooltipText={_("Connect")} onClicked={submit}>
                <image iconName="object-select-symbolic" />
              </button>
              <button cssClasses={["manifold-module"]} tooltipText={_("Cancel")} onClicked={dismiss}>
                <image iconName="window-close-symbolic" />
              </button>
            </box>
          </box>
        ) as Gtk.Widget,
    )
    ssidEntry.connect("activate", () => password.grab_focus())
    password.connect("activate", submit)

    // Escape closes the prompt before it means anything else. The control
    // centre also listens for Escape -- to leave the page, and then to close --
    // and a key event reaches this page on its way up to the window, so taking
    // it here first gives the three the order a user expects.
    const keys = new Gtk.EventControllerKey()
    keys.connect("key-pressed", (_controller, keyval: number) => {
      if (keyval !== Gdk.KEY_Escape || pending.get() === null) return false
      dismiss()
      return true
    })
    page.add_controller(keys)

    // -- header ------------------------------------------------------------
    const header = inScope(
      () =>
        (
          <box cssClasses={["manifold-cc-header"]} spacing={6}>
            <button cssClasses={["manifold-module"]} tooltipText={_("Back")} onClicked={back}>
              <image iconName="go-previous-symbolic" />
            </button>
            <label cssClasses={["title"]} hexpand halign={Gtk.Align.START} label={_("Wi-Fi")} />
            <button
              cssClasses={["manifold-module"]}
              tooltipText={_("Join a hidden network")}
              onClicked={() => {
                setPending({ kind: "hidden" })
                ssidEntry.grab_focus()
              }}
            >
              <image iconName={addIcon()} />
            </button>
            <button
              cssClasses={["manifold-module"]}
              tooltipText={_("Scan")}
              sensitive={createBinding(wifi, "scanning").as((busy) => !busy)}
              onClicked={() => wifi.scan()}
            >
              <image iconName="view-refresh-symbolic" />
            </button>
            <switch
              active={createBinding(wifi, "enabled")}
              onNotifyActive={(self: Gtk.Switch) => {
                if (self.active !== wifi.enabled) wifi.enabled = self.active
              }}
            />
          </box>
        ) as Gtk.Widget,
    )

    // -- list --------------------------------------------------------------
    const items = createComputed(
      [
        createBinding(wifi, "accessPoints"),
        createBinding(wifi, "activeAccessPoint"),
        savedNames,
      ],
      (points, active, saved): Item[] => {
        // One network usually advertises several access points; the list shows
        // the strongest of each name rather than one row per radio.
        const strongest = new Map<string, AstalNetworkNS.AccessPoint>()

        for (const ap of points) {
          const ssid = ap.ssid
          if (!ssid) continue
          const seen = strongest.get(ssid)
          if (!seen || ap.strength > seen.strength) strongest.set(ssid, ap)
        }

        return [...strongest.values()]
          .map((ap) => ({
            ssid: ap.ssid!,
            strength: ap.strength,
            icon: ap.iconName,
            active: active !== null && ap.ssid === active.ssid,
            secured: ap.requiresPassword,
            saved: saved.includes(ap.ssid!),
            ap,
          }))
          .sort((a, b) => Number(b.active) - Number(a.active) || b.strength - a.strength)
      },
    )

    function onClicked(item: Item): void {
      if (item.active) {
        // One argument, not two: the callback is the only parameter.
        void network!.wifi?.deactivate_connection(null)
        return
      }
      // A saved profile already carries its secret; only an unknown secured
      // network needs the user to type one.
      if (item.secured && !item.saved) setPending({ kind: "password", ap: item.ap })
      else connect(item.ap, null)
    }

    const rows = inScope(
      () =>
        (
          <box orientation={Gtk.Orientation.VERTICAL} spacing={2}>
            <For
              each={items}
              id={(item: Item) =>
                `${item.ssid}:${item.active}:${item.saved}:${Math.round(item.strength / 10)}`
              }
            >
              {(item: Item) => (
                // The row is two targets, the way a quick-settings tile is: the
                // body joins or leaves the network, and the button beside it
                // deletes the saved profile. Only saved networks grow the
                // second one -- there is nothing to forget about the rest.
                <box cssClasses={["manifold-device-row-group"]}>
                  <button
                    cssClasses={
                      item.active
                        ? ["manifold-device-row", "active"]
                        : ["manifold-device-row"]
                    }
                    hexpand
                    onClicked={() => onClicked(item)}
                  >
                    <box spacing={10}>
                      <image iconName={item.icon} />
                      <label
                        halign={Gtk.Align.START}
                        hexpand
                        ellipsize={3}
                        maxWidthChars={16}
                        label={item.ssid}
                      />
                      <image
                        iconName="network-wireless-encrypted-symbolic"
                        visible={item.secured}
                        cssClasses={["dim"]}
                      />
                      <image
                        iconName="object-select-symbolic"
                        visible={item.active}
                      />
                    </box>
                  </button>
                  <button
                    cssClasses={["manifold-device-forget"]}
                    visible={item.saved}
                    tooltipText={_("Forget this network")}
                    onClicked={() => forget(item)}
                  >
                    <image iconName="user-trash-symbolic" />
                  </button>
                </box>
              )}
            </For>
          </box>
        ) as Gtk.Widget,
    )

    // Exactly one of the two fills the page: the list when there is one, the
    // notice centred in its place when there is not, so the panel keeps the one
    // size either way.
    const nothingToShow = createComputed(
      [createBinding(wifi, "enabled"), items],
      (enabled, list) => !enabled || list.length === 0,
    )

    const empty = inScope(
      () =>
        (
          <label
            cssClasses={["manifold-device-empty", "dim"]}
            valign={Gtk.Align.CENTER}
            vexpand
            visible={nothingToShow}
            label={createBinding(wifi, "enabled").as((enabled) =>
              enabled ? _("Looking for networks…") : _("Turn on Wi-Fi to see networks"),
            )}
          />
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

    list.append(rows)
    page.append(header)
    page.append(prompt)
    page.append(empty)
    page.append(listArea)

    // A list that never scans goes stale within minutes.
    if (wifi.enabled) wifi.scan()
  })()

  return page
}
