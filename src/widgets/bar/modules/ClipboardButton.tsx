import { Gtk } from "ags/gtk4"
import { createBinding } from "ags"
import { _ } from "../../../lib/i18n"

import ClipboardService from "../../../services/clipboard"
import { WindowName, togglePopup } from "../../names"

/**
 * Opens the clipboard history.
 *
 * Hides itself when wl-clipboard is missing, since without it the history can
 * never fill and an empty button is just a dead affordance.
 */
export default function ClipboardButton(): Gtk.Widget {
  const clipboard = ClipboardService.get_default()

  return (
    <button
      cssClasses={["manifold-module", "manifold-clipboard-button"]}
      tooltipText={_("Clipboard history")}
      valign={Gtk.Align.CENTER}
      visible={createBinding(clipboard, "available")}
      onClicked={() => togglePopup(WindowName.Clipboard)}
    >
      <image iconName="edit-paste-symbolic" />
    </button>
  ) as Gtk.Widget
}
