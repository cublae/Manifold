import GLib from "gi://GLib"
import { Gtk } from "ags/gtk4"
import { createBinding, createComputed, createState } from "ags"
import { createPoll } from "ags/time"
import type AstalMprisNS from "gi://AstalMpris"

import * as system from "../../services/system"
import { appIcons, loadAppIcons, resolveAppIcon } from "../../lib/appIcons"
import { captureScope } from "../../lib/scope"

/**
 * Now playing, drawn as a card with the cover art behind it.
 *
 * The art is a background rather than a thumbnail, so the text needs a scrim to
 * stay readable over whatever the album happens to look like. Position is
 * polled once a second: MPRIS reports `position` on request but does not notify
 * as it advances, so there is nothing to subscribe to.
 */

function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00"
  const total = Math.floor(seconds)
  const minutes = Math.floor(total / 60)
  return `${minutes}:${String(total % 60).padStart(2, "0")}`
}

export default function MediaCard(): Gtk.Widget {
  const inScope = captureScope()
  loadAppIcons()

  const root = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    cssClasses: ["manifold-media-card"],
    visible: false,
    // GTK4 clips through the widget property, not through CSS overflow, and
    // without it the cover art spills past the card's rounded corners.
    overflow: Gtk.Overflow.HIDDEN,
  })

  void (async () => {
    const mpris = await system.mpris()
    if (!mpris) return

    let current: AstalMprisNS.Player | null = null

    const clear = () => {
      let child = root.get_first_child()
      while (child) {
        const next = child.get_next_sibling()
        root.remove(child)
        child = next
      }
    }

    const build = (player: AstalMprisNS.Player) =>
      inScope(() => {
        clear()
        current = player

        // -- background ----------------------------------------------------
        const art = new Gtk.Picture({
          contentFit: Gtk.ContentFit.COVER,
          canShrink: true,
          cssClasses: ["cover"],
        })

        const artBinding = createBinding(player, "coverArt")
        const stopArt = artBinding.subscribe(() => {
          const path = artBinding.get()
          // The path is a cache file MPRIS fills in after the download lands,
          // so it can exist before the file does.
          if (path && GLib.file_test(path, GLib.FileTest.EXISTS)) art.set_filename(path)
          else art.set_paintable(null)
        })
        const initial = artBinding.get()
        if (initial && GLib.file_test(initial, GLib.FileTest.EXISTS)) art.set_filename(initial)
        art.connect("destroy", () => stopArt())

        // -- foreground ----------------------------------------------------
        const appIcon = createComputed([createBinding(player, "entry"), appIcons], (entry, index) =>
          resolveAppIcon(index, entry),
        )

        const header = (
          <box cssClasses={["media-header"]} halign={Gtk.Align.END} spacing={6}>
            <image iconName={appIcon} pixelSize={14} />
            <label cssClasses={["app"]} label={createBinding(player, "identity")} />
          </box>
        ) as Gtk.Widget

        const title = (
          <label
            cssClasses={["title"]}
            halign={Gtk.Align.START}
            xalign={0}
            ellipsize={3}
            maxWidthChars={22}
            label={createBinding(player, "title").as((value) => value || "Unknown track")}
          />
        ) as Gtk.Widget

        const artist = (
          <label
            cssClasses={["artist"]}
            halign={Gtk.Align.START}
            xalign={0}
            ellipsize={3}
            maxWidthChars={22}
            label={createBinding(player, "artist")}
          />
        ) as Gtk.Widget

        // MPRIS does not push position updates, so it is polled.
        const position = createPoll(0, 1000, () => player.position)
        const time = createComputed([position, createBinding(player, "length")], (at, length) =>
          length > 0 ? `${clock(at)} / ${clock(length)}` : clock(at),
        )

        const controls = (
          <box cssClasses={["controls"]} spacing={2} halign={Gtk.Align.END} valign={Gtk.Align.END}>
            <button
              cssClasses={["flat"]}
              sensitive={createBinding(player, "canGoPrevious")}
              onClicked={() => player.previous()}
            >
              <image iconName="media-skip-backward-symbolic" />
            </button>
            <button cssClasses={["flat", "play"]} onClicked={() => player.play_pause()}>
              <image
                iconName={createBinding(player, "playbackStatus").as((status) =>
                  String(status) === "0"
                    ? "media-playback-pause-symbolic"
                    : "media-playback-start-symbolic",
                )}
              />
            </button>
            <button
              cssClasses={["flat"]}
              sensitive={createBinding(player, "canGoNext")}
              onClicked={() => player.next()}
            >
              <image iconName="media-skip-forward-symbolic" />
            </button>
          </box>
        ) as Gtk.Widget

        const bottom = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, valign: Gtk.Align.END })
        const left = new Gtk.Box({
          orientation: Gtk.Orientation.VERTICAL,
          valign: Gtk.Align.END,
          hexpand: true,
        })
        left.append(title)
        left.append(artist)
        left.append(
          (<label cssClasses={["time"]} halign={Gtk.Align.START} label={time} />) as Gtk.Widget,
        )
        bottom.append(left)
        bottom.append(controls)

        const foreground = new Gtk.Box({
          orientation: Gtk.Orientation.VERTICAL,
          cssClasses: ["media-foreground"],
        })
        foreground.append(header)
        foreground.append(new Gtk.Box({ vexpand: true }))
        foreground.append(bottom)

        // The card must be 120px tall whatever the artwork measures. An
        // Overlay takes its size from its main child, and overlay children are
        // not measured unless asked to be -- so the main child is an empty box
        // of the wanted height and the art rides on top of it.
        const overlay = new Gtk.Overlay()
        overlay.set_child(new Gtk.Box({ heightRequest: 120 }))
        overlay.add_overlay(art)
        // A scrim between art and text; without it the labels vanish over a
        // bright cover.
        overlay.add_overlay(new Gtk.Box({ cssClasses: ["media-scrim"] }))
        overlay.add_overlay(foreground)

        root.append(overlay)
        root.set_visible(true)
      })

    const sync = () => {
      const player = mpris.get_players()[0] ?? null
      if (!player) {
        clear()
        current = null
        root.set_visible(false)
        return
      }
      if (player !== current) build(player)
    }

    mpris.connect("notify::players", sync)
    sync()
    root.connect("destroy", clear)
  })()

  return root
}
