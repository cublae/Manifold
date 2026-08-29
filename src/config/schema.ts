/**
 * The shape of `~/.config/manifold/config.json`.
 *
 * This file is the single source of truth for what the shell can be told to do.
 * The Home Manager module generates JSON against this schema, so any option
 * added here should get a matching Nix option in `modules/home-manager.nix`.
 */

export type BarPosition = "top" | "bottom" | "left" | "right"
export type ColorScheme = "light" | "dark" | "auto"

/**
 * Identifiers accepted in `bar.modules.*`. See `widgets/bar/registry.ts`.
 *
 * Every id here needs an entry in that registry and a line in the Home Manager
 * module's `barModule` enum; nothing but review keeps the three lists in step.
 */
export type BarModuleId =
  | "workspaces"
  | "focused-window"
  | "clock"
  | "keyboard-layout"
  | "system-indicators"
  | "tray"
  | "notifications"
  | "launcher"
  | "clipboard"
  | "control-center"
  | "media"
  | "recording"
  | "screencast"
  | "privacy"
  | "resources"
  | "weather"
  | "spacer"

/** Module layout: what sits in each of the bar's three sections. */
export interface BarModules {
  start: BarModuleId[]
  center: BarModuleId[]
  end: BarModuleId[]
}

export interface BarConfig {
  enabled: boolean
  position: BarPosition
  /**
   * Bar thickness in logical pixels: height when horizontal, width when
   * vertical. The bar reserves this much screen space.
   */
  size: number
  /** Show a bar on every monitor, or only the primary one. */
  onAllMonitors: boolean
  /** Module layout. Order within each list is the order on screen. */
  modules: BarModules
  /**
   * Layouts for individual outputs, keyed by connector name -- `eDP-1`,
   * `DP-2`, the names `niri msg outputs` prints.
   *
   * Sections left out fall back to `bar.modules`, so a laptop screen that
   * should carry the battery and a monitor that should not differ by one line
   * rather than by two full layouts. An unknown name is simply never matched,
   * which is what makes a config with a monitor unplugged still valid.
   */
  outputs: Record<string, Partial<BarModules>>
}

export interface WorkspacesConfig {
  /** Only show workspaces belonging to the monitor the bar is on. */
  perMonitor: boolean
  /**
   * Show workspaces that hold no windows. niri always keeps one spare, so
   * this is off by default -- otherwise the bar carries a trailing slot that
   * is never anything else. The workspace in focus is shown either way.
   */
  showEmpty: boolean
  /** Label style: the workspace index, its name, or nothing (dots only). */
  labels: "index" | "name" | "none"
  /** Show an icon per window sitting on the workspace. */
  showIcons: boolean
  /** Most icons drawn per workspace before the rest are dropped. */
  maxIcons: number
}

export interface ClockConfig {
  /** strftime format for the bar label. */
  format: string
  /** strftime format for the hover tooltip. */
  tooltipFormat: string
  /**
   * strftime format used when the bar is vertical, where a wide time does not
   * fit. Newlines are honoured, so "%H\n%M" stacks hours over minutes.
   */
  verticalFormat: string
}

export interface MediaConfig {
  /** Longest title shown in the bar, in characters. */
  maxLength: number
}

export interface ResourcesConfig {
  /** Milliseconds between readings. */
  interval: number
  showCpu: boolean
  showMemory: boolean
  showTemperature: boolean
}

export interface WeatherConfig {
  /**
   * Place name to report the weather for, e.g. `Reykjavik` or `Porto, Portugal`.
   *
   * Looked up once through Open-Meteo's geocoder, which answers with
   * coordinates *and* the place's own name -- which is the only way the module
   * can show a city at all, since the forecast API returns no name.
   *
   * `latitude`/`longitude` override this when set, for anyone who wants a
   * precise point; the name from the lookup is still what gets displayed.
   */
  location: string
  /**
   * Exact coordinates, used instead of looking `location` up.
   *
   * There is no sensible default for either. Guessing from the IP address
   * would mean handing the address to a geolocation service before the user
   * has agreed to anything, and guessing from the timezone puts you in the
   * wrong half of a continent. So the module stays quiet until it is told
   * where it is, by one route or the other.
   */
  latitude: number
  longitude: number
  /** `metric` gives °C and km/h; `imperial` gives °F and mph. */
  units: "metric" | "imperial"
  /** Minutes between fetches. Weather does not move fast; the floor is 5. */
  interval: number
}

export interface DesktopConfig {
  /**
   * Show widgets on the desktop.
   *
   * They sit above the wallpaper and below every window, and only while the
   * monitor's active workspace holds nothing -- a clock behind a full-screen
   * editor is a clock nobody can see.
   */
  enabled: boolean
  /** strftime format for the large clock. */
  clockFormat: string
  /** strftime format for the line under it. */
  dateFormat: string
  showDate: boolean
  /** Show what is playing, when something is. */
  showMedia: boolean
}

export interface CalendarConfig {
  /**
   * Weekday the grid starts on.
   *
   * The C library knows this per locale, but neither GLib nor GTK hands the
   * answer out, so it is a setting rather than a guess.
   */
  firstDay: "monday" | "sunday"
}

export interface FocusedWindowConfig {
  /** Truncate the title past this many characters. 0 disables truncation. */
  maxLength: number
  /** Show the app id instead of the window title. */
  showAppId: boolean
}

export interface NotificationsConfig {
  /** Seconds a popup stays on screen. Critical notifications ignore this. */
  timeout: number
  /**
   * Corner popups appear in.
   *
   * `auto` follows the bar: popups rise from the bottom when the bar is there,
   * drop from the top when it is not.
   */
  position:
    | "auto"
    | "top-right"
    | "top-left"
    | "top-center"
    | "bottom-right"
    | "bottom-left"
    | "bottom-center"
  /** Most popups on screen at once; the rest queue in the centre. */
  maxPopups: number
  /** Suppress popups without dropping the notifications themselves. */
  doNotDisturb: boolean
}

export interface LauncherConfig {
  /** Minimum fuzzy score, 0..1. Lower is more permissive. */
  minScore: number
  /** Show apps marked NoDisplay in their .desktop entry. */
  showHidden: boolean
}

export interface AnimationsConfig {
  /**
   * Master switch. GTK's own `gtk-enable-animations` still wins over this: if
   * the desktop asks for reduced motion, the shell holds still either way.
   */
  enabled: boolean
  /**
   * Base duration in milliseconds. Panels, notifications and page transitions
   * all run at this length.
   */
  duration: number
}

export interface AudioConfig {
  /**
   * Highest volume the shell allows, where 1 is 100%.
   *
   * PipeWire happily goes past 100% and the keys bound to `wpctl` will take it
   * there, which is loud and distorted on most hardware. The shell watches the
   * default output and pulls anything above this back down.
   */
  maxVolume: number
}

export interface OsdConfig {
  /** Milliseconds the overlay stays up after the last change. */
  timeout: number
  /** Screen edge the overlay appears near. */
  position: "bottom" | "top" | "center"
  /**
   * Corner radius of the level bar, in pixels. 0 is square; any value at or
   * above half the bar's height gives a pill.
   */
  barRadius: number
}

export interface ClipboardConfig {
  /** History depth. Older entries fall off the end. */
  maxEntries: number
  /** Entries listed before a search narrows them down. */
  maxVisible: number
  /**
   * Start `wl-paste --watch cliphist store` alongside the shell.
   *
   * cliphist does not watch the clipboard by itself. Turn this off if the
   * watchers are already started elsewhere -- running them twice is harmless,
   * cliphist dedupes, but there is no point.
   */
  manageDaemon: boolean
  /**
   * Keep history across restarts, in the user's cache directory.
   *
   * The file is plain text, so anything copied ends up readable on disk.
   * Only applies to the built-in wl-clipboard fallback: with cliphist the
   * history is cliphist's own database and this is ignored.
   */
  persist: boolean
}

export interface ScreenRecordConfig {
  /**
   * What gpu-screen-recorder captures: `portal`, `focused`, a monitor name, or
   * `region`. On a session that does not hand out direct DRM access, `portal`
   * is the only target that works.
   */
  target: string
  fps: number
  /** Audio device to mix in, e.g. `default_output`. Empty records silence. */
  audio: string
  /** Where recordings are written. Empty means ~/Videos. */
  directory: string
}

export interface InterfaceConfig {
  /**
   * Language of the shell's own text.
   *
   * `auto` follows the locale. Only the shell is affected: application names,
   * notification bodies and window titles arrive already written by whoever
   * sent them.
   *
   * Settled once at startup. A config reload rebuilds the windows, so a change
   * takes effect without restarting the shell.
   */
  language: "auto" | "en" | "ru"
}

export interface ThemeConfig {
  /** `auto` follows the desktop `color-scheme` preference. */
  mode: ColorScheme
  /** Accent colour as a hex string. Overrides the libadwaita accent. */
  accent: string
  /**
   * Take the accent from the wallpaper instead of `accent`.
   *
   * The colour picked is the most *present* one worth using as a colour, not
   * the largest area: the biggest region of a photograph is usually sky or
   * shadow, and an accent made of those cannot be told apart from the panel.
   * A greyscale wallpaper yields nothing and `accent` stands.
   */
  accentFromWallpaper: boolean
  /**
   * Where the wallpaper is, for `accentFromWallpaper`.
   *
   * Empty asks around instead: waypaper records the answer in its config, and
   * swww can be queried. Wayland has no protocol for this and no compositor
   * owns it, so a setter neither of those covers needs the path spelled out.
   */
  wallpaper: string
  /**
   * Corner radius in pixels for panels, the launcher and the controls in them.
   *
   * `null` follows the desktop instead: the blanket `* { border-radius }` rule
   * that theme generators write into `~/.config/gtk-4.0/gtk.css`, and square
   * corners when there is no such rule. Anything inside the shell that is a
   * pill by design -- sliders, the unread dot -- stays a pill either way.
   */
  radius: number | null
  /**
   * Milliseconds the screen is held still while light and dark swap over.
   *
   * niri freezes what is on screen for this long and then cross-fades to
   * whatever is there afterwards, so the switch is a dissolve rather than every
   * window blinking at once. The delay has to cover the slowest application
   * repainting, not just this shell, which is why it is worth a tenth of a
   * second rather than a frame. 0 turns it off.
   */
  transition: number
  /** Base spacing unit, in pixels. Paddings are multiples of this. */
  spacing: number
  /** Panel background opacity, 0..1. */
  opacity: number
  /** Font family override. Empty string keeps the system font. */
  font: string
}

/** Feature switches for modules beyond the bar. */
export interface ModulesConfig {
  controlCenter: boolean
  /** The mihomo proxy tile. Hidden anyway when MihomoManifold is not installed. */
  proxy: boolean
  notifications: boolean
  launcher: boolean
  clipboard: boolean
  osd: boolean
}

export interface ManifoldConfig {
  bar: BarConfig
  workspaces: WorkspacesConfig
  clock: ClockConfig
  calendar: CalendarConfig
  weather: WeatherConfig
  desktop: DesktopConfig
  interface: InterfaceConfig
  media: MediaConfig
  resources: ResourcesConfig
  focusedWindow: FocusedWindowConfig
  notifications: NotificationsConfig
  launcher: LauncherConfig
  osd: OsdConfig
  audio: AudioConfig
  animations: AnimationsConfig
  clipboard: ClipboardConfig
  screenRecord: ScreenRecordConfig
  theme: ThemeConfig
  modules: ModulesConfig
}

export const defaultConfig: ManifoldConfig = {
  bar: {
    enabled: true,
    position: "bottom",
    size: 38,
    onAllMonitors: true,
    modules: {
      start: ["launcher", "clipboard", "workspaces", "media"],
      center: ["clock"],
      // `resources` is deliberately absent: a bar is a glance, and a running
      // percentage of CPU and a temperature are numbers to watch, not to
      // glance at. It stays one line away in `bar.modules` for those who want
      // it.
      // `privacy` and `screencast` are in the default layout on purpose, and
      // they cost nothing to leave there: both are invisible until something
      // is actually using the microphone, the camera or the screen. An
      // indicator you have to know about and switch on is not one.
      end: [
        "privacy",
        "screencast",
        "recording",
        "tray",
        "keyboard-layout",
        "notifications",
        "system-indicators",
      ],
    },
    outputs: {},
  },
  workspaces: {
    perMonitor: true,
    showEmpty: false,
    labels: "index",
    showIcons: true,
    maxIcons: 4,
  },
  clock: {
    format: "%H:%M",
    tooltipFormat: "%A, %e %B %Y",
    verticalFormat: "%H\n%M",
  },
  calendar: {
    firstDay: "monday",
  },
  weather: {
    location: "",
    latitude: 0,
    longitude: 0,
    units: "metric",
    interval: 30,
  },
  interface: {
    language: "auto",
  },
  desktop: {
    enabled: false,
    clockFormat: "%H:%M",
    dateFormat: "%A, %e %B",
    showDate: true,
    showMedia: true,
  },
  media: {
    maxLength: 24,
  },
  resources: {
    interval: 2000,
    showCpu: true,
    showMemory: true,
    showTemperature: true,
  },
  focusedWindow: {
    maxLength: 48,
    showAppId: false,
  },
  notifications: {
    timeout: 5,
    position: "auto",
    maxPopups: 3,
    doNotDisturb: false,
  },
  launcher: {
    minScore: 0.2,
    showHidden: false,
  },
  osd: {
    timeout: 1500,
    position: "bottom",
    barRadius: 0,
  },
  animations: {
    enabled: true,
    duration: 180,
  },
  audio: {
    maxVolume: 1,
  },
  screenRecord: {
    target: "portal",
    fps: 60,
    audio: "default_output",
    directory: "",
  },
  clipboard: {
    manageDaemon: true,
    maxEntries: 200,
    maxVisible: 20,
    persist: true,
  },
  theme: {
    mode: "auto",
    accent: "#3584e4",
    accentFromWallpaper: false,
    wallpaper: "",
    radius: null,
    transition: 250,
    spacing: 6,
    opacity: 1,
    font: "",
  },
  modules: {
    controlCenter: true,
    proxy: true,
    notifications: true,
    launcher: true,
    clipboard: true,
    osd: true,
  },
}

/** Recursive partial, for user files that only override a few keys. */
export type PartialConfig = {
  [K in keyof ManifoldConfig]?: Partial<ManifoldConfig[K]>
}
