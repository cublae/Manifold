import { Gtk } from "ags/gtk4"
import Pango from "gi://Pango?version=1.0"
import { createBinding, createComputed } from "ags"

import Niri from "../../../services/niri"
import { config, type BarPosition } from "../../../config"
import { appIcons, loadAppIcons, resolveAppIcon } from "../../../lib/appIcons"
import { isVertical } from "../../../lib/barLayout"
import { prettifyAppId, truncate } from "../../../lib/utils"

/**
 * The focused window.
 *
 * A title is meaningless in a bar a few dozen pixels wide, so a vertical bar
 * shows the application's icon instead and keeps the title in the tooltip.
 */
export default function FocusedWindow({ position }: { position: BarPosition }): Gtk.Widget {
  const niri = Niri.get_default()
  const vertical = isVertical(position)

  const focused = createBinding(niri, "focusedWindow")

  const tooltip = focused((window) => window?.title ?? "")
  const visible = focused((window) => window !== null)

  if (vertical) {
    loadAppIcons()

    const icon = createComputed([focused, appIcons], (window, index) =>
      window ? resolveAppIcon(index, window.app_id) : "application-x-executable",
    )

    return (
      <box cssClasses={["manifold-module", "manifold-focused-window"]}>
        <image iconName={icon} tooltipText={tooltip} visible={visible} />
      </box>
    ) as Gtk.Widget
  }

  const text = focused((window) => {
    if (!window) return ""
    const { maxLength, showAppId } = config.get().focusedWindow
    const raw = showAppId ? prettifyAppId(window.app_id) : (window.title ?? "")
    return truncate(raw, maxLength)
  })

  return (
    <box cssClasses={["manifold-module", "manifold-focused-window"]}>
      <label
        label={text}
        tooltipText={tooltip}
        ellipsize={Pango.EllipsizeMode.END}
        maxWidthChars={64}
        // Collapse the module entirely when nothing is focused, rather than
        // leaving an empty chip in the bar.
        visible={visible}
      />
    </box>
  ) as Gtk.Widget
}
