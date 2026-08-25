import { Gtk } from "ags/gtk4"
import { createBinding } from "ags"
import type AstalMprisNS from "gi://AstalMpris"

import * as system from "../../../services/system"
import { config, type BarPosition } from "../../../config"
import { isVertical } from "../../../lib/barLayout"

/**
 * What is playing, in the bar.
 *
 * The full card with artwork and a seek bar lives in the control centre; this
 * is the glance version: play state and title, with the click everyone expects
 * from it. Scrolling steps through tracks.
 *
 * One player is followed at a time -- whichever is playing, else the first that
 * appeared -- because a bar has room for a line, not for a queue.
 */

/** `AstalMpris.PlaybackStatus.PLAYING`, without importing the library for it. */
const PLAYING = 0

export default function Media({ position }: { position: BarPosition }): Gtk.Widget {
  const button = new Gtk.Button({
    cssClasses: ["manifold-module", "manifold-media"],
    valign: Gtk.Align.CENTER,
    // Nothing to show until a player turns up.
    visible: false,
  })

  const icon = new Gtk.Image({ iconName: "media-playback-start-symbolic" })

  const label = new Gtk.Label({
    ellipsize: 3,
    maxWidthChars: Math.max(6, config.get().media.maxLength),
    // A vertical bar has no room for a title; the icon carries it alone.
    visible: !isVertical(position),
  })

  const content = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 6 })
  content.append(icon)
  content.append(label)
  button.set_child(content)

  let current: AstalMprisNS.Player | null = null
  let handlers: number[] = []

  function draw(): void {
    if (!current) {
      button.set_visible(false)
      return
    }

    const playing = current.playbackStatus === PLAYING
    icon.set_from_icon_name(
      playing ? "media-playback-pause-symbolic" : "media-playback-start-symbolic",
    )
    label.set_label(current.title || current.identity || "")
    button.set_tooltip_text(
      [current.artist, current.title].filter(Boolean).join(" — ") || current.identity || "",
    )
    button.set_visible(true)
  }

  /** Follow one player, dropping the handlers of the one before it. */
  function follow(player: AstalMprisNS.Player | null): void {
    if (player === current) return

    for (const handler of handlers) current?.disconnect(handler)
    handlers = []
    current = player

    if (player) {
      handlers = ["notify::playback-status", "notify::title", "notify::artist"].map((signal) =>
        player.connect(signal, draw),
      )
    }

    draw()
  }

  void (async () => {
    const mpris = await system.mpris()
    if (!mpris) return

    // Bound to the list rather than to a player: they come and go, and which
    // one is worth showing is decided again every time that happens.
    const players = createBinding(mpris, "players")
    const watched = new WeakSet<AstalMprisNS.Player>()

    const pick = (): void => {
      const all = players.get()

      // A player that starts playing while another is on screen should take
      // over, so the choice is redone on status changes as well as on the list.
      for (const player of all) {
        if (watched.has(player)) continue
        watched.add(player)
        player.connect("notify::playback-status", pick)
      }

      follow(all.find((candidate) => candidate.playbackStatus === PLAYING) ?? all[0] ?? null)
    }

    players.subscribe(pick)
    pick()

    button.connect("clicked", () => current?.play_pause())

    const scroll = new Gtk.EventControllerScroll({
      flags: Gtk.EventControllerScrollFlags.VERTICAL,
    })
    scroll.connect("scroll", (_controller, _dx, dy: number) => {
      if (!current) return true
      if (dy < 0) current.next()
      else current.previous()
      return true
    })
    button.add_controller(scroll)
  })()

  return button
}
