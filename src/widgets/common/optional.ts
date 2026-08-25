import type { Gtk } from "ags/gtk4"

/**
 * Build a widget that depends on an optional system library.
 *
 * A static `import "gi://AstalNetwork"` is resolved when the module is loaded,
 * and it throws if the typelib -- or any typelib it depends on, such as NM for
 * NetworkManager -- is missing. That happens before any widget code runs, so a
 * try/catch around the *use* site cannot help: the whole shell fails to start.
 *
 * Dynamic `import()` moves that resolution to call time, where it is an
 * ordinary rejected promise. A machine with no NetworkManager, no WirePlumber
 * or no battery therefore loses one indicator instead of its entire shell.
 */
export async function optional(
  name: string,
  build: () => Promise<Gtk.Widget | null>,
): Promise<Gtk.Widget | null> {
  try {
    return await build()
  } catch (error) {
    console.log(`manifold: indicator "${name}" unavailable, skipping (${error})`)
    return null
  }
}
