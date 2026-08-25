import { Gtk } from "ags/gtk4"
import type { Accessor } from "ags"
import { _ } from "../../lib/i18n"

/**
 * A quick-settings tile: icon, title, subtitle, and an optional chevron.
 *
 * The chevron is a separate button rather than part of the tile, so pressing
 * the body toggles the thing and pressing the arrow opens its detail page --
 * two targets, one tile, which is how every quick-settings panel behaves.
 *
 * A tile with no detail page is one button and nothing else. Holding the
 * chevron's width open on those looked tidy at rest and wrong under the
 * pointer: the hover highlight stopped short of the edge and drew a slot for an
 * arrow that was never coming.
 */

/** Width of the chevron column. */
const CHEVRON_WIDTH = 26

export interface QuickTileProps {
  icon: string | Accessor<string>
  label: string
  /**
   * Second line. Every tile should have one: without it the body is a line
   * shorter than its neighbours and the grid looks ragged.
   */
  subtitle: Accessor<string> | string
  /** Accented when true. */
  active: Accessor<boolean>
  onClicked: () => void
  /** Given, the tile grows a chevron that opens a detail page. */
  onExpand?: () => void
}

export default function QuickTile({
  icon,
  label,
  subtitle,
  active,
  onClicked,
  onExpand,
}: QuickTileProps): Gtk.Widget {
  const text = (
    <box orientation={Gtk.Orientation.VERTICAL} valign={Gtk.Align.CENTER} hexpand>
      <label cssClasses={["title"]} halign={Gtk.Align.START} label={label} />
      <label
        cssClasses={["subtitle"]}
        halign={Gtk.Align.START}
        ellipsize={3}
        maxWidthChars={12}
        label={subtitle}
      />
    </box>
  ) as Gtk.Widget

  // A tile with no chevron is a single button, so it carries the rounding on
  // both sides and its hover reaches the tile's own edges.
  const solo = onExpand === undefined

  const body = (
    <button
      cssClasses={active.as((on) => {
        const classes = ["manifold-tile-body"]
        if (solo) classes.push("solo")
        if (on) classes.push("active")
        return classes
      })}
      hexpand
      vexpand
      onClicked={onClicked}
    >
      <box spacing={10}>
        <image iconName={icon} pixelSize={18} />
        {text}
      </box>
    </button>
  ) as Gtk.Widget

  const tile = new Gtk.Box({
    orientation: Gtk.Orientation.HORIZONTAL,
    cssClasses: ["manifold-tile"],
    hexpand: true,
    // Fills its grid cell, so every tile ends up the same height.
    vexpand: true,
  })
  tile.append(body)

  if (onExpand) {
    tile.append(
      (
        <button
          cssClasses={active.as((on) =>
            on ? ["manifold-tile-expand", "active"] : ["manifold-tile-expand"],
          )}
          widthRequest={CHEVRON_WIDTH}
          tooltipText={_("Show all")}
          onClicked={onExpand}
        >
          <image iconName="go-next-symbolic" pixelSize={14} />
        </button>
      ) as Gtk.Widget,
    )
  }

  return tile
}
