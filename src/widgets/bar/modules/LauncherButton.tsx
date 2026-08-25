import { Gtk } from "ags/gtk4"
import { _ } from "../../../lib/i18n"

import { firstIcon } from "../../../lib/icons"
import { WindowName, togglePopup } from "../../names"

/** Opens the application launcher. */
export default function LauncherButton(): Gtk.Widget {
  return (
    <button
      cssClasses={["manifold-module", "manifold-launcher-button"]}
      tooltipText={_("Search applications")}
      valign={Gtk.Align.CENTER}
      onClicked={() => togglePopup(WindowName.Launcher)}
    >
      {/* The launcher opens on a search field, so it is a magnifier rather than
          an app grid. Both names below are a magnifier; Adwaita and every
          third-party set carry at least one of them. */}
      <image iconName={firstIcon("system-search-symbolic", "edit-find-symbolic")} />
    </button>
  ) as Gtk.Widget
}
