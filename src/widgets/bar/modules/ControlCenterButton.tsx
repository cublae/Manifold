import { Gtk } from "ags/gtk4"
import { _ } from "../../../lib/i18n"

import { WindowName, togglePopup } from "../../names"

/**
 * An explicit control-center button.
 *
 * Redundant when `system-indicators` is on the bar -- that already opens the
 * control center -- but kept as a module for layouts that hide the indicators
 * or want a separate affordance.
 */
export default function ControlCenterButton(): Gtk.Widget {
  return (
    <button
      cssClasses={["manifold-module", "manifold-control-center-button"]}
      tooltipText={_("Control center")}
      onClicked={() => togglePopup(WindowName.ControlCenter)}
    >
      <image iconName="open-menu-symbolic" />
    </button>
  ) as Gtk.Widget
}
