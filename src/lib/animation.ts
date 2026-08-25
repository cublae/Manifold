import { Gtk } from "ags/gtk4"

import { config } from "../config"

/**
 * Animation policy.
 *
 * Two switches decide whether anything moves: Manifold's own `animations`
 * section and GTK's `gtk-enable-animations`, which is what accessibility
 * settings and remote sessions turn off. Either one is enough to stop them, so
 * the shell follows the desktop rather than overriding it.
 *
 * Durations are read at build time -- `Gtk.Revealer` and `Gtk.Stack` take them
 * as properties, not as CSS -- which is fine because a config reload rebuilds
 * every window anyway.
 */

/** Longest animation the shell will play. Past this it stops reading as motion. */
const MAX_DURATION = 1000

function systemAllowsAnimations(): boolean {
  const settings = Gtk.Settings.get_default()
  // No settings object means no display, which means nothing to animate.
  return settings ? settings.gtkEnableAnimations : false
}

export function animationsEnabled(): boolean {
  return config.get().animations.enabled && systemAllowsAnimations()
}

/** Base duration in milliseconds, or 0 when animations are off. */
export function animationDuration(): number {
  if (!animationsEnabled()) return 0
  return Math.min(Math.max(0, config.get().animations.duration), MAX_DURATION)
}

/**
 * Direction a dropdown slides from.
 *
 * A panel should appear to come out of the bar it belongs to, so the slide
 * follows the bar's edge: a top bar drops its panels downwards.
 */
export function slideFrom(position: string): Gtk.RevealerTransitionType {
  if (!animationsEnabled()) return Gtk.RevealerTransitionType.NONE

  switch (position) {
    case "bottom":
      return Gtk.RevealerTransitionType.SLIDE_UP
    case "left":
      return Gtk.RevealerTransitionType.SLIDE_RIGHT
    case "right":
      return Gtk.RevealerTransitionType.SLIDE_LEFT
    default:
      return Gtk.RevealerTransitionType.SLIDE_DOWN
  }
}

/** Crossfade, or nothing at all when animations are off. */
export function fade(): Gtk.RevealerTransitionType {
  return animationsEnabled()
    ? Gtk.RevealerTransitionType.CROSSFADE
    : Gtk.RevealerTransitionType.NONE
}
