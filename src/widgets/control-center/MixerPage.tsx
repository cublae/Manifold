import { Gtk } from "ags/gtk4"
import { For, createBinding, createComputed } from "ags"
import type AstalWpNS from "gi://AstalWp"
import { _ } from "../../lib/i18n"

import * as system from "../../services/system"
import { appImage } from "../../lib/icons"
import { captureScope } from "../../lib/scope"
import FatSlider from "./FatSlider"

/**
 * Per-application volume.
 *
 * WirePlumber calls a playing application a *stream*, and every stream carries
 * its own volume and mute, so the mixer is one slider per stream over the same
 * control the main page uses for the output as a whole.
 *
 * The list is bound rather than rebuilt: a slider that is torn down and rebuilt
 * under a dragging pointer loses the drag, and streams come and go constantly
 * as applications start and stop playing.
 */

export interface MixerPageProps {
  /** Return to the main quick-settings page. */
  back: () => void
}

function volumeIcon(stream: AstalWpNS.Stream): string {
  // WirePlumber hands out the application's own icon where it knows one; the
  // volume icon is the fallback, and says something useful either way.
  return stream.icon || stream.volumeIcon || "audio-x-generic-symbolic"
}

/** Best name for a stream: "Spotify", not "playback-stream-42". */
function streamName(stream: AstalWpNS.Stream): string {
  return stream.description || stream.name || "Unknown application"
}

function Row(stream: AstalWpNS.Stream): Gtk.Widget {
  const row = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 4,
    cssClasses: ["manifold-mixer-row"],
  })

  const header = (
    <box spacing={8}>
      {appImage(volumeIcon(stream), 16, "audio-x-generic-symbolic")}
      <label
        cssClasses={["name"]}
        hexpand
        halign={Gtk.Align.START}
        ellipsize={3}
        maxWidthChars={28}
        label={streamName(stream)}
      />
      <button
        cssClasses={createBinding(stream, "mute").as((mute) =>
          mute ? ["manifold-module", "active"] : ["manifold-module"],
        )}
        tooltipText={_("Mute")}
        onClicked={() => (stream.mute = !stream.mute)}
      >
        <image
          iconName={createBinding(stream, "mute").as((mute) =>
            mute ? "audio-volume-muted-symbolic" : "audio-volume-high-symbolic",
          )}
        />
      </button>
    </box>
  ) as Gtk.Widget

  row.append(header)
  row.append(
    FatSlider({
      icon: createComputed(
        [createBinding(stream, "volume"), createBinding(stream, "mute")],
        (volume, mute) =>
          mute || volume <= 0 ? "audio-volume-muted-symbolic" : "audio-volume-high-symbolic",
      ),
      value: createBinding(stream, "volume"),
      onChange: (value) => {
        stream.volume = value
        if (stream.mute && value > 0) stream.mute = false
      },
    }),
  )

  return row
}

/**
 * One selectable device: the row is the whole target, the tick marks the one
 * everything currently plays through.
 */
function DeviceRow(endpoint: AstalWpNS.Endpoint): Gtk.Widget {
  const active = createBinding(endpoint, "isDefault")

  return (
    <button
      cssClasses={active.as((on) =>
        on ? ["manifold-device-row", "active"] : ["manifold-device-row"],
      )}
      onClicked={() => endpoint.set_is_default(true)}
    >
      <box spacing={10}>
        {appImage(endpoint.icon, 16, "audio-card-symbolic")}
        <label
          hexpand
          halign={Gtk.Align.START}
          ellipsize={3}
          maxWidthChars={30}
          label={endpoint.description || endpoint.name || "Unknown device"}
        />
        <image iconName="object-select-symbolic" visible={active} />
      </box>
    </button>
  ) as Gtk.Widget
}

/** A titled block inside the page. */
function Section(title: string, body: Gtk.Widget): Gtk.Widget {
  const box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 4 })
  box.append(
    new Gtk.Label({
      label: title,
      halign: Gtk.Align.START,
      cssClasses: ["manifold-mixer-section", "dim"],
    }),
  )
  box.append(body)
  return box
}

export default function MixerPage({ back }: MixerPageProps): Gtk.Widget {
  const inScope = captureScope()

  const list = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 10,
    cssClasses: ["manifold-mixer-list"],
  })

  // Fills whatever height the panel has rather than growing to fit the list:
  // the control centre pins the page to its own size, and anything past that
  // scrolls.
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

  page.append(
    (
      <box cssClasses={["manifold-cc-header"]} spacing={6}>
        <button cssClasses={["manifold-module"]} tooltipText={_("Back")} onClicked={back}>
          <image iconName="go-previous-symbolic" />
        </button>
        <label cssClasses={["title"]} hexpand halign={Gtk.Align.START} label={_("Volume mixer")} />
      </box>
    ) as Gtk.Widget,
  )

  void (async () => {
    const wp = await system.wireplumber()
    const audio = wp?.audio
    if (!audio) {
      page.append(
        inScope(() => (<label cssClasses={["dim"]} label={_("No audio server")} />) as Gtk.Widget),
      )
      return
    }

    // The three lists are nullable in the library; `For` wants something it can
    // iterate, so the empty case is normalised here rather than at every use.
    const streams = createBinding(audio, "streams").as((all) => all ?? [])
    const speakers = createBinding(audio, "speakers").as((all) => all ?? [])
    const microphones = createBinding(audio, "microphones").as((all) => all ?? [])

    const devices = (
      each: typeof speakers,
    ): Gtk.Widget =>
      inScope(() => (
        <box orientation={Gtk.Orientation.VERTICAL} spacing={2}>
          <For each={each} id={(endpoint: AstalWpNS.Endpoint) => String(endpoint.id)}>
            {(endpoint: AstalWpNS.Endpoint) => DeviceRow(endpoint)}
          </For>
        </box>
      ) as Gtk.Widget)

    // Nothing playing is the normal state, so it gets a line rather than the
    // whole page: the device lists above it are worth showing either way.
    const applications = inScope(() => (
      <box orientation={Gtk.Orientation.VERTICAL} spacing={10}>
        <label
          cssClasses={["manifold-device-empty", "dim"]}
          halign={Gtk.Align.START}
          visible={streams.as((all) => all.length === 0)}
          label={_("Nothing is playing")}
        />
        <For each={streams} id={(stream: AstalWpNS.Stream) => String(stream.id)}>
          {(stream: AstalWpNS.Stream) => Row(stream)}
        </For>
      </box>
    ) as Gtk.Widget)

    list.append(Section(_("Output"), devices(speakers)))
    list.append(Section(_("Input"), devices(microphones)))
    list.append(Section(_("Applications"), applications))

    page.append(scroller)
  })()

  return page
}
