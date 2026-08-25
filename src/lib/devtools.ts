import GLib from "gi://GLib"
import { monitorFile } from "ags/file"
import { execAsync } from "ags/process"

import { config } from "../config"
import { applyStyles } from "./theme"

/**
 * Development helpers. None of this runs unless `MANIFOLD_DEV=1`.
 *
 * The compiled stylesheet is baked into the bundle at build time, so in a
 * normal install a style change means a rebuild. During development it is far
 * more useful to recompile the SCSS on save and swap the provider live, which
 * is what this does.
 */

export function devMode(): boolean {
  return GLib.getenv("MANIFOLD_DEV") === "1"
}

function styleEntry(): string {
  return (
    GLib.getenv("MANIFOLD_STYLE_SRC") ??
    `${GLib.get_current_dir()}/src/styles/main.scss`
  )
}

/** Recompile the SCSS tree and re-apply it, keeping runtime overrides on top. */
async function recompile(entry: string): Promise<void> {
  const out = `${GLib.get_tmp_dir()}/manifold-dev-${GLib.get_user_name()}.css`

  try {
    await execAsync(["sass", "--no-source-map", entry, out])
    applyStyles(config.get(), out)
    console.log("manifold: stylesheet reloaded")
  } catch (error) {
    // A syntax error in the SCSS should print and leave the old sheet in place.
    console.error(`manifold: sass failed, keeping previous stylesheet:\n${error}`)
  }
}

/** Watch the SCSS tree and hot-swap the stylesheet on every save. */
export function watchStyles(): void {
  if (!devMode()) return

  const entry = styleEntry()
  const dir = entry.slice(0, entry.lastIndexOf("/"))

  if (!GLib.file_test(dir, GLib.FileTest.IS_DIR)) {
    console.error(`manifold: MANIFOLD_DEV is set but ${dir} does not exist; not watching styles`)
    return
  }

  console.log(`manifold: dev mode, watching ${dir} for style changes`)
  monitorFile(dir, () => void recompile(entry))
  void recompile(entry)
}
