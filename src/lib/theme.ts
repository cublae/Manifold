import Adw from "gi://Adw?version=1"
import GLib from "gi://GLib"
import app from "ags/gtk4/app"

import { config as liveConfig, type ManifoldConfig, type ThemeConfig } from "../config"
import Niri from "../services/niri"
import { currentWallpaper, watchWallpaper } from "../services/wallpaper"
import { accentFromImage } from "./dominantColor"
import { animationDuration } from "./animation"
import { clamp, isHexColor } from "./utils"

/**
 * Theming.
 *
 * Manifold does not ship its own palette. It renders against libadwaita's named
 * colours (`@window_bg_color`, `@accent_bg_color`, ...), which means light/dark
 * switching is handled by `AdwStyleManager` for free and the shell tracks the
 * user's GNOME accent and contrast settings.
 *
 * Two things still come from Manifold's own config, and neither can live in the
 * SCSS -- that is compiled at build time, whereas config is read at runtime:
 *
 *   - the accent override, emitted as `@define-color` in a higher-priority
 *     provider, which is libadwaita's documented recolouring mechanism;
 *   - metrics (radius, spacing, opacity, font), emitted as concrete rules,
 *     because GTK CSS has no author-defined variables before 4.16.
 */

/** Matches the $transition token in the stylesheet. */
const EASE = "cubic-bezier(0.25, 0.46, 0.45, 0.94)"

function colorScheme(mode: ThemeConfig["mode"]): Adw.ColorScheme {
  switch (mode) {
    case "light":
      return Adw.ColorScheme.FORCE_LIGHT
    case "dark":
      return Adw.ColorScheme.FORCE_DARK
    default:
      return Adw.ColorScheme.DEFAULT
  }
}


/**
 * The corner radius the user's own GTK stylesheet asks for.
 *
 * There is no GTK *setting* for rounding -- neither `Gtk.Settings` nor
 * libadwaita has one -- so the only place a desktop-wide answer exists is
 * `~/.config/gtk-4.0/gtk.css`, which theme generators write a blanket
 * `* { border-radius: Npx }` into. GTK applies that file to Manifold like any
 * other GTK4 application, but a `*` rule loses to every class rule in the
 * shell's own sheet, so the number is read here instead and fed to the same
 * tokens the sheet uses.
 *
 * Returns null when the file has no such rule, which is the usual case.
 */
function gtkStylesheetRadius(): number | null {
  const path = `${GLib.get_user_config_dir()}/gtk-4.0/gtk.css`

  let contents: Uint8Array
  try {
    const [ok, data] = GLib.file_get_contents(path)
    if (!ok) return null
    contents = data
  } catch {
    // No file, or unreadable: nothing to follow.
    return null
  }

  const css = new TextDecoder().decode(contents)

  // The last blanket rule wins, the same way it would in the cascade.
  const rule = /(^|[},])\s*\*\s*\{[^}]*?border-radius:\s*([0-9]+(?:\.[0-9]+)?)px/gs
  let radius: number | null = null
  for (const match of css.matchAll(rule)) radius = Number(match[2])

  return radius
}

/** Build the runtime override stylesheet for the current config. */
export function overrideCss(config: ManifoldConfig): string {
  const { spacing, opacity, font } = config.theme
  const rules: string[] = []

  // The wallpaper's colour when there is one. `wallpaperAccent` is filled in
  // asynchronously -- reading and quantising an image is not something to do on
  // the way to painting a window -- so the first sheet of a session uses the
  // configured accent and the second one, moments later, has the real answer.
  const accent = (config.theme.accentFromWallpaper && wallpaperAccent) || config.theme.accent

  if (isHexColor(accent)) {
    // `accent_bg_color` fills buttons; `accent_color` tints text and icons.
    // libadwaita derives the rest of the accent ramp from these two.
    rules.push(
      `@define-color accent_bg_color ${accent};`,
      `@define-color accent_color ${accent};`,
    )
  } else if (accent) {
    console.error(`manifold: theme.accent "${accent}" is not a hex colour, ignoring`)
  }

  // Radius. `theme.radius` wins; with nothing set the shell follows the user's
  // GTK stylesheet, and failing that squares everything off. The three tokens
  // the compiled sheet reads are defined here, on the shell's own windows, so
  // that every rounded rule in it follows without being restated.
  const radius = config.theme.radius ?? gtkStylesheetRadius() ?? 0
  const r = clamp(radius, 0, 32)
  const s = clamp(spacing, 0, 24)
  const a = clamp(opacity, 0, 1)

  rules.push(
    `window.manifold-window {` +
      ` --manifold-radius-lg: ${r}px;` +
      ` --manifold-radius-md: ${Math.max(0, r - 4)}px;` +
      ` --manifold-radius-sm: ${Math.max(0, r - 6)}px;` +
      ` }`,
    `.manifold-panel, .manifold-bar-panel { background-color: alpha(@window_bg_color, ${a}); }`,
    `.manifold-module { padding: 0 ${s}px; }`,
    `.manifold-bar-section { margin: 0 ${s}px; }`,
  )

  // The OSD level bar carries its own radius: it is a track, not a panel, and
  // reads very differently square than pill-shaped. Both nodes need it -- the
  // fill is a node inside the trough and rounds independently of it.
  const osdRadius = clamp(config.osd.barRadius, 0, 999)
  rules.push(
    `.manifold-osd levelbar.manifold-osd-bar trough,` +
      `.manifold-osd levelbar.manifold-osd-bar block { border-radius: ${osdRadius}px; }`,
  )

  // Animation timings. The revealers take their duration as a property, but
  // everything that fades or highlights does it in CSS, which is compiled at
  // build time and so has to be rewritten here.
  //
  // The panel fade is only emitted when animations are on. It starts at zero
  // opacity and is brought up by the `revealed` class, so a panel shown by any
  // path that does not set that class would stay invisible -- not a risk worth
  // running when the rules do nothing anyway.
  const d = animationDuration()

  rules.push(`.manifold-module { transition: background-color ${d}ms ${EASE}; }`)

  if (d > 0) {
    rules.push(
      `.manifold-popup { opacity: 0; transition: opacity ${d}ms ${EASE}; }`,
      `.manifold-popup.revealed { opacity: 1; }`,
    )
  }

  if (font) rules.push(`.manifold-root { font-family: "${font}"; }`)

  return rules.join("\n")
}

let baseCss = ""

/** The accent taken from the wallpaper, once it has been worked out. */
let wallpaperAccent: string | null = null

/** The wallpaper the current `wallpaperAccent` came from, so it is done once. */
let wallpaperSource: string | null = null

/**
 * Work out the accent from the wallpaper, and re-apply the styles if it moved.
 *
 * Re-entrant on purpose: this runs at startup, on every config reload, and
 * whenever the wallpaper changes, and all three can land close together. The
 * path check makes the repeats free.
 */
async function refreshWallpaperAccent(): Promise<void> {
  const theme = liveConfig.get().theme

  if (!theme.accentFromWallpaper) {
    // Turned off since last time: drop back to the configured accent.
    if (wallpaperAccent === null) return
    wallpaperAccent = null
    wallpaperSource = null
    applyStyles(liveConfig.get())
    return
  }

  const path = await currentWallpaper(theme.wallpaper)
  if (!path) {
    if (theme.wallpaper === "") {
      console.log("manifold: accentFromWallpaper is on but no wallpaper was found")
    }
    return
  }
  if (path === wallpaperSource) return

  const accent = accentFromImage(path)
  wallpaperSource = path

  // Null means the picture had no colour in it -- a greyscale wallpaper. The
  // configured accent stands rather than the shell inventing one.
  if (accent === null || accent === wallpaperAccent) return

  wallpaperAccent = accent
  applyStyles(liveConfig.get())
}

/**
 * Follow the wallpaper for the rest of the session.
 *
 * Called once at startup. The accent is worked out immediately and again
 * whenever the wallpaper changes; a config reload calls `applyStyles`, which
 * re-checks on its own.
 */
export function watchWallpaperAccent(): void {
  void refreshWallpaperAccent()
  watchWallpaper(() => void refreshWallpaperAccent())
}

/**
 * Cross-fade the screen through a light/dark switch.
 *
 * A theme change repaints every window on the same frame, which reads as the
 * whole screen blinking. niri can do better: `DoScreenTransition` freezes what
 * is on screen, hands back control for `delay_ms`, and then fades from the
 * frozen copy to whatever is there now. So the call has to come *before* the
 * repaint, and the delay has to be long enough for every application to finish
 * following the setting -- not just this shell.
 *
 * Nothing waits on it. A compositor that does not answer, or does not have the
 * action, must not hold up the theme change itself.
 */
function crossFade(ms: number): void {
  if (ms <= 0) return
  void Niri.get_default().dispatch({ DoScreenTransition: { delay_ms: ms } })
}

/**
 * Fade the screen when the desktop flips between light and dark on its own.
 *
 * `theme.mode: auto` follows the system preference, which changes without the
 * shell being asked -- a schedule, a toggle in Settings. The switch is worth
 * fading for whoever caused it, so this watches the outcome rather than the
 * cause and catches every route in one place.
 */
export function watchColorScheme(): void {
  const manager = Adw.StyleManager.get_default()
  let dark = manager.dark

  manager.connect("notify::dark", () => {
    if (manager.dark === dark) return
    dark = manager.dark
    crossFade(liveConfig.get().theme.transition)
  })
}

/**
 * Apply the compiled stylesheet plus the config-derived overrides.
 *
 * Order matters: `reset` clears every provider Manifold installed, so the base
 * sheet has to be re-applied before the overrides go back on top.
 */
export function applyStyles(config: ManifoldConfig, base: string = baseCss): void {
  baseCss = base

  // A reload may have switched the wallpaper accent on, off, or onto a
  // different picture. The check is cheap and the work behind it is skipped
  // when nothing moved; when something did, it re-enters here with the answer.
  void refreshWallpaperAccent()

  // The fade has to be asked for *before* the repaint, or niri freezes the new
  // screen and fades it to itself. That rules out checking afterwards whether
  // the switch changed anything, so the test is whether the colour scheme is
  // changing at all. Switching between `auto` and an explicit mode that agrees
  // with the system therefore fades between two identical frames -- which is
  // invisible, and costs only the freeze.
  const manager = Adw.StyleManager.get_default()
  const scheme = colorScheme(config.theme.mode)

  if (scheme !== manager.colorScheme) {
    crossFade(config.theme.transition)
    manager.set_color_scheme(scheme)
  }

  app.apply_css(baseCss, true)
  app.apply_css(overrideCss(config))
}
