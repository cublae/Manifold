import { Gtk } from "ags/gtk4"
import { createBinding } from "ags"

import Niri from "../../../services/niri"

/** Compress "English (US)" to "EN", "Russian" to "RU". */
function shortLabel(name: string): string {
  if (!name) return ""
  const parenthesised = name.match(/\(([^)]+)\)/)
  const base = name.split(" ")[0] ?? name
  const code = base.slice(0, 2).toUpperCase()
  // Prefer the region for layouts that only differ by it, e.g. English (US).
  return parenthesised ? `${code}` : code
}

export default function KeyboardLayout(): Gtk.Widget {
  const niri = Niri.get_default()

  return (
    <button
      cssClasses={["manifold-module", "manifold-keyboard-layout"]}
      tooltipText={createBinding(niri, "keyboardLayout")}
      // Only worth showing when more than one layout is configured.
      visible={createBinding(niri, "keyboardLayouts").as((layouts) => layouts.names.length > 1)}
      onClicked={() => niri.dispatch({ SwitchLayout: { layout: "Next" } })}
    >
      <label label={createBinding(niri, "keyboardLayout").as(shortLabel)} />
    </button>
  ) as Gtk.Widget
}
