import Gdk from "gi://Gdk?version=4.0"
import { Astal, Gtk } from "ags/gtk4"
import app from "ags/gtk4/app"
import { _ } from "../../lib/i18n"

import ClipboardService, { decodeImage, type ClipboardEntry } from "../../services/clipboard"
import { config } from "../../config"
import { popupAlignment, positionClass } from "../../lib/barLayout"
import { revealPanel } from "../common/revealPanel"
import { setWindowVisible } from "../common/popupVisibility"
import { WindowName } from "../names"

/**
 * Clipboard history.
 *
 * Deliberately its own window rather than a mode of the launcher: the two
 * search different things and a shared entry that silently changes meaning is
 * harder to use than two keybindings. It takes the same exclusive keyboard
 * grab the launcher does, for the same reason.
 *
 * An entry holding an image gets a thumbnail: cliphist keeps the bytes and
 * describes them as `[[ binary data … ]]`, which tells the user nothing about
 * what they copied.
 */

/** Thumbnail box for an image entry. Fixed, so rows keep one height. */
const THUMBNAIL_WIDTH = 64
const THUMBNAIL_HEIGHT = 44

export default function ClipboardPopup(): Astal.Window {
  const position = config.get().bar.position
  const clipboard = ClipboardService.get_default()

  const entry = new Gtk.Entry({
    placeholderText: _("Search clipboard…"),
    cssClasses: ["manifold-launcher-entry"],
    hexpand: true,
    primaryIconName: "edit-paste-symbolic",
  })

  const list = new Gtk.ListBox({
    selectionMode: Gtk.SelectionMode.BROWSE,
    cssClasses: ["manifold-launcher-list"],
  })

  const empty = new Gtk.Label({
    label: _("Clipboard history is empty"),
    cssClasses: ["manifold-launcher-empty", "dim"],
    visible: false,
  })

  const scroller = new Gtk.ScrolledWindow({
    hscrollbarPolicy: Gtk.PolicyType.NEVER,
    vscrollbarPolicy: Gtk.PolicyType.AUTOMATIC,
    propagateNaturalHeight: true,
    maxContentHeight: 420,
    child: list,
  })

  const clear = (
    <button
      cssClasses={["manifold-module"]}
      tooltipText={_("Clear history")}
      onClicked={() => {
        void clipboard.clear().then(refresh)
      }}
    >
      <image iconName="user-trash-symbolic" />
    </button>
  ) as Gtk.Widget

  const header = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 6 })
  header.append(entry)
  header.append(clear)

  const content = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 10,
    cssClasses: ["manifold-popup-content", "manifold-launcher", "manifold-clipboard"],
    widthRequest: 520,
  })
  content.append(header)
  content.append(empty)
  content.append(scroller)

  const panel = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    cssClasses: [
      "manifold-panel",
      "manifold-root",
      "manifold-popup",
      // Same flush edge as the bar dropdowns; the class carries it.
      positionClass(position),
    ],
  })
  panel.append(content)

  const root = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    hexpand: true,
    vexpand: true,
  })
  const window = (
    <window
      name={WindowName.Clipboard}
      namespace="manifold-clipboard"
      cssClasses={["manifold-window"]}
      application={app}
      anchor={
        Astal.WindowAnchor.TOP |
        Astal.WindowAnchor.BOTTOM |
        Astal.WindowAnchor.LEFT |
        Astal.WindowAnchor.RIGHT
      }
      exclusivity={Astal.Exclusivity.NORMAL}
      layer={Astal.Layer.TOP}
      keymode={Astal.Keymode.EXCLUSIVE}
      visible={false}
    >
      {root}
    </window>
  ) as Astal.Window

  // Filled in after the window exists: the revealer takes over its visibility.
  // Centred along the bar, and on the bar's own side of the screen.
  root.append(revealPanel({ window, panel, position, ...popupAlignment(position, "center") }))

  let shown: ClipboardEntry[] = []

  function close(): void {
    setWindowVisible(window, false)
    entry.set_text("")
  }

  function paste(item: ClipboardEntry | undefined): void {
    if (!item) return
    close()
    void clipboard.copy(item)
  }

  /** Largest image worth decoding for a thumbnail. */
  const PREVIEW_LIMIT = 8 * 1024 * 1024

  function row(item: ClipboardEntry): Gtk.Widget {
    const box = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 12 })

    if (item.image) {
      // A fixed box, filled in once the decode lands: the row must not resize
      // when the picture arrives, or the list jumps under the pointer.
      const frame = new Gtk.Box({
        widthRequest: THUMBNAIL_WIDTH,
        heightRequest: THUMBNAIL_HEIGHT,
        overflow: Gtk.Overflow.HIDDEN,
        cssClasses: ["manifold-clipboard-thumbnail"],
      })
      box.append(frame)

      if (item.image.bytes <= PREVIEW_LIMIT) {
        void decodeImage(item).then((path) => {
          if (!path) return

          const picture = Gtk.Picture.new_for_filename(path)
          picture.set_content_fit(Gtk.ContentFit.COVER)
          picture.set_size_request(THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT)
          frame.append(picture)
        })
      }

      const text = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        valign: Gtk.Align.CENTER,
        hexpand: true,
      })
      text.append(
        new Gtk.Label({
          label: `${item.image.type.toUpperCase()} ${item.image.dimensions}`,
          halign: Gtk.Align.START,
          cssClasses: ["name"],
        }),
      )
      text.append(
        new Gtk.Label({
          label: item.image.size,
          halign: Gtk.Align.START,
          cssClasses: ["description", "dim"],
        }),
      )
      box.append(text)

      return new Gtk.ListBoxRow({ cssClasses: ["manifold-launcher-row"], child: box })
    }

    const text = new Gtk.Label({
      label: item.preview,
      halign: Gtk.Align.START,
      ellipsize: 3,
      maxWidthChars: 60,
      hexpand: true,
      cssClasses: ["name"],
    })
    box.append(text)

    return new Gtk.ListBoxRow({ cssClasses: ["manifold-launcher-row"], child: box })
  }

  function refresh(): void {
    const query = entry.get_text().trim().toLowerCase()
    const all = clipboard.entries

    shown = query
      ? all.filter((item) => item.preview.toLowerCase().includes(query))
      : all.slice(0, Math.max(1, config.get().clipboard.maxVisible))

    let child = list.get_first_child()
    while (child) {
      const next = child.get_next_sibling()
      list.remove(child)
      child = next
    }
    for (const item of shown) list.append(row(item))

    empty.set_visible(shown.length === 0)
    scroller.set_visible(shown.length > 0)

    const first = list.get_row_at_index(0)
    if (first) list.select_row(first)
  }

  entry.connect("changed", refresh)
  entry.connect("activate", () => paste(shown[list.get_selected_row()?.get_index() ?? 0]))
  list.connect("row-activated", (_list, selected: Gtk.ListBoxRow) =>
    paste(shown[selected.get_index()]),
  )

  const keys = new Gtk.EventControllerKey()
  keys.connect("key-pressed", (_controller, keyval: number) => {
    if (keyval === Gdk.KEY_Escape) {
      close()
      return true
    }

    const index = list.get_selected_row()?.get_index() ?? 0

    if (keyval === Gdk.KEY_Down) {
      const next = list.get_row_at_index(index + 1)
      if (next) list.select_row(next)
      return true
    }
    if (keyval === Gdk.KEY_Up) {
      const previous = list.get_row_at_index(Math.max(0, index - 1))
      if (previous) list.select_row(previous)
      return true
    }
    return false
  })
  window.add_controller(keys)

  const click = new Gtk.GestureClick({ button: 0 })
  click.connect("pressed", (_gesture, _n: number, x: number, y: number) => {
    const [ok, bounds] = panel.compute_bounds(root)
    if (!ok) return
    const inside =
      x >= bounds.origin.x &&
      x <= bounds.origin.x + bounds.size.width &&
      y >= bounds.origin.y &&
      y <= bounds.origin.y + bounds.size.height
    if (!inside) close()
  })
  root.add_controller(click)

  window.connect("notify::visible", () => {
    if (!window.visible) return
    entry.set_text("")
    // cliphist has no change notification, so the history is re-read each time
    // the popup opens rather than kept in sync continuously.
    void clipboard.reload().then(refresh)
    entry.grab_focus()
  })

  return window
}
