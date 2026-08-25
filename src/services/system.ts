import type AstalBluetoothNS from "gi://AstalBluetooth"
import type AstalBrightnessNS from "gi://AstalBrightness"
import type AstalAppsNS from "gi://AstalApps"
import type AstalMprisNS from "gi://AstalMpris"
import type AstalNetworkNS from "gi://AstalNetwork"
import type AstalNotifdNS from "gi://AstalNotifd"
import type NMNS from "gi://NM"
import type AstalPowerProfilesNS from "gi://AstalPowerProfiles"
import type AstalTrayNS from "gi://AstalTray"
import type AstalWpNS from "gi://AstalWp"

/**
 * Accessors for the optional system services.
 *
 * Every one of these libraries is optional. A static `import "gi://AstalNetwork"`
 * resolves when the module loads and throws if the typelib -- or a typelib it
 * depends on, such as NM -- is missing, which happens before any widget code
 * runs and takes the whole shell down with it. Dynamic `import()` moves that to
 * call time, where a missing library is an ordinary rejected promise.
 *
 * Each accessor caches its promise, so the library is loaded and the singleton
 * resolved exactly once no matter how many widgets ask for it.
 */

function lazy<T>(name: string, load: () => Promise<T | null>): () => Promise<T | null> {
  let cached: Promise<T | null> | null = null

  return () => {
    cached ??= load().catch((error) => {
      console.log(`manifold: system service "${name}" unavailable (${error})`)
      return null
    })
    return cached
  }
}

/** WirePlumber session. */
export const wireplumber = lazy("wireplumber", async () => {
  const AstalWp = (await import("gi://AstalWp")).default as typeof AstalWpNS
  return AstalWp.get_default()
})

/** Default audio output endpoint, the one a volume control should drive. */
export const speaker = lazy("speaker", async () => {
  const wp = await wireplumber()
  return wp?.audio?.defaultSpeaker ?? null
})

/** Default audio input endpoint. */
export const microphone = lazy("microphone", async () => {
  const wp = await wireplumber()
  return wp?.audio?.defaultMicrophone ?? null
})

/** NetworkManager. */
export const network = lazy("network", async () => {
  const AstalNetwork = (await import("gi://AstalNetwork")).default as typeof AstalNetworkNS
  return AstalNetwork.get_default()
})

/** BlueZ. */
export const bluetooth = lazy("bluetooth", async () => {
  const AstalBluetooth = (await import("gi://AstalBluetooth")).default as typeof AstalBluetoothNS
  return AstalBluetooth.get_default()
})

/**
 * The screen backlight device.
 *
 * `AstalBrightness.get_default()` is a registry of devices; `screen` is the
 * backlight proxy, whose `brightness` is normalised to 0..1 and is settable.
 * Machines with no backlight -- desktops, external-only setups -- report null.
 */
export const backlight = lazy("brightness", async () => {
  const AstalBrightness = (await import("gi://AstalBrightness")).default as typeof AstalBrightnessNS
  return AstalBrightness.get_default()?.screen ?? null
})

/** StatusNotifierItem host. */
export const tray = lazy("tray", async () => {
  const AstalTray = (await import("gi://AstalTray")).default as typeof AstalTrayNS
  return AstalTray.get_default()
})

/** Enum values needed by callers, re-exported so they need not import the lib. */
export const networkPrimary = lazy("network-primary-enum", async () => {
  const AstalNetwork = (await import("gi://AstalNetwork")).default as typeof AstalNetworkNS
  return AstalNetwork.Primary
})

/**
 * NetworkManager's own library.
 *
 * AstalNetwork covers what a list of networks needs and stops there: it can
 * join a network and leave one, but not forget a saved profile or dial an SSID
 * that is never advertised. Both of those are one NM call away, and NM is
 * already in the process -- AstalNetwork is built on it -- so this is the same
 * library seen directly rather than a second dependency.
 */
export const networkManager = lazy("networkmanager", async () => {
  return (await import("gi://NM?version=1.0")).default as typeof NMNS
})

/**
 * Notification daemon.
 *
 * Only one process may own `org.freedesktop.Notifications`. If another shell
 * already holds it, AstalNotifd still constructs but never receives anything --
 * so an empty notification list is a legitimate state, not a bug.
 */
export const notifd = lazy("notifd", async () => {
  const AstalNotifd = (await import("gi://AstalNotifd")).default as typeof AstalNotifdNS
  return AstalNotifd.get_default()
})

/** Index of installed .desktop entries, with fuzzy search. */
export const apps = lazy("apps", async () => {
  const AstalApps = (await import("gi://AstalApps")).default as typeof AstalAppsNS
  return new AstalApps.Apps()
})

/**
 * The AstalApps namespace.
 *
 * `services/applications.ts` builds `Application` objects from desktop files it
 * finds itself, which needs the class rather than the singleton.
 */
export const astalApps = lazy("astal-apps", async () => {
  return (await import("gi://AstalApps")).default as typeof AstalAppsNS
})

/** MPRIS players. */
export const mpris = lazy("mpris", async () => {
  const AstalMpris = (await import("gi://AstalMpris")).default as typeof AstalMprisNS
  return AstalMpris.get_default()
})

/** power-profiles-daemon. */
export const powerProfiles = lazy("power-profiles", async () => {
  const AstalPowerProfiles = (await import("gi://AstalPowerProfiles")).default as typeof AstalPowerProfilesNS
  return AstalPowerProfiles.get_default()
})

/** Urgency enum, for callers that must not import the library themselves. */
export const notifdUrgency = lazy("notifd-urgency", async () => {
  const AstalNotifd = (await import("gi://AstalNotifd")).default as typeof AstalNotifdNS
  return AstalNotifd.Urgency
})
