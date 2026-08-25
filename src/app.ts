import Adw from "gi://Adw?version=1"
import GLib from "gi://GLib"
import { Gtk } from "ags/gtk4"
import app from "ags/gtk4/app"

import style from "./styles/main.scss"
import { config, configPath, watchConfig } from "./config"
import { applyStyles, watchColorScheme, watchWallpaperAccent } from "./lib/theme"
import { watchStyles } from "./lib/devtools"
import { setLanguage } from "./lib/i18n"
import Niri from "./services/niri"
import ClipboardService from "./services/clipboard"
import { pickColor } from "./services/colorPicker"
import { editing, setEditingDesktop, toggleEditingDesktop } from "./widgets/desktop/edit"
import Recorder from "./services/recorder"
import enforceVolumeLimit from "./services/audio"
import { rebuildWindows, registerWindows, unregisterWindows } from "./widgets/windows"
import { WindowName } from "./widgets/names"
import { POPUPS, findWindow, togglePopup } from "./widgets/names"
import { setWindowVisible } from "./widgets/common/popupVisibility"
import { openControlCenterPage } from "./widgets/control-center/ControlCenter"

/**
 * Manifold -- a desktop shell for niri.
 *
 * Startup order matters:
 *   1. libadwaita is initialised, which installs the Adwaita stylesheet and the
 *      named colours the whole theme is written against;
 *   2. styles are applied, so windows never flash unstyled;
 *   3. the niri service connects, priming itself from the event stream;
 *   4. windows are built.
 *
 * A second invocation of the binary does not start a second shell: GApplication
 * forwards its command line to the running instance, which answers through
 * `requestHandler`. That is what makes `manifold toggle launcher` a usable
 * compositor keybinding.
 */

const USAGE = `manifold — a desktop shell for niri

Running \`manifold\` with no arguments starts the shell. Running it again while
an instance is up forwards the command to it:

  manifold toggle launcher
  manifold toggle control-center
  manifold toggle calendar
  manifold toggle notification-center
  manifold control-center wifi   open the control center on a page
  manifold pick-color         pick a colour off the screen, onto the clipboard
  manifold desktop edit       rearrange the desktop widgets (also: on, off)
  manifold reload             reread the config and rebuild every window
  manifold windows            list the shell's windows
  manifold inspector          open the GTK inspector
  manifold quit               stop the shell
`

function reload(): void {
  applyStyles(config.get())
  rebuildWindows()
}

/**
 * Rebuild on the next idle turn rather than in the caller's callback.
 *
 * Both callers arrive from inside a GLib source -- a file monitor or a DBus
 * method -- and rebuilding tears down every layer surface the shell owns.
 * Doing that while GTK is dispatching for those surfaces crashes in GDK, so
 * the work is queued for a turn of the main loop that owns nothing.
 */
function scheduleReload(): void {
  GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
    reload()
    return GLib.SOURCE_REMOVE
  })
}

app.start({
  instanceName: "manifold",

  main() {
    // libadwaita defines the named colours (@window_bg_color, @accent_bg_color,
    // ...) that the whole stylesheet is written against, so it has to be
    // initialised before any widget exists. ags/gtk4 already does this on
    // import; the call is idempotent and kept explicit so the dependency is
    // visible rather than inherited by luck.
    Adw.init()

    // Before any widget exists: every string is translated as it is built.
    setLanguage(config.get().interface.language)

    applyStyles(config.get(), style)
    watchStyles()

    // Fades the screen when the desktop flips light/dark behind our back.
    watchColorScheme()

    // Follows the wallpaper, when theme.accentFromWallpaper asks it to.
    watchWallpaperAccent()

    // Rebuild on config change so module lists and bar geometry take effect
    // without a restart.
    // Guarded: a failure in any one subsystem must not stop the windows
    // below from being built, or the shell comes up with no surfaces at all.
    try {
      watchConfig(() => {
        console.log(`manifold: reloaded ${configPath()}`)
        scheduleReload()
      })
    } catch (error) {
      console.error(`manifold: config watch failed: ${error}`)
    }

    // Constructing the service early gets the event stream connecting while
    // the windows are still being built.
    if (!GLib.file_test(configPath(), GLib.FileTest.EXISTS)) {
      console.log(`manifold: no config at ${configPath()}, using defaults`)
    }

    Niri.get_default()

    // Watches the default output and holds it to `audio.maxVolume`.
    enforceVolumeLimit()

    registerWindows()
  },

  /**
   * Handles both `manifold <command>` from a second invocation and
   * `ags request -i manifold <command>`.
   */
  requestHandler(argv: string[], respond: (response: string) => void) {
    // GApplication passes the whole command line, argv[0] being the binary.
    const args = argv.filter((arg) => !arg.endsWith("/manifold") && arg !== "manifold")
    const [command, ...rest] = args

    switch (command) {
      case undefined:
      case "help":
      case "--help":
        return respond(USAGE)

      case "reload":
        scheduleReload()
        return respond("reloaded")

      case "toggle": {
        const name = rest[0]
        if (!name) return respond("usage: toggle <window>")

        // Route dropdowns through togglePopup so a keybinding behaves exactly
        // like a click on the bar, including closing whichever was open.
        if (POPUPS.includes(name)) {
          togglePopup(name)
        } else {
          try {
            app.toggle_window(name)
          } catch (error) {
            return respond(`${error}`)
          }
        }
        return respond(`toggled ${name}`)
      }

      case "control-center": {
        // `manifold control-center wifi` opens straight onto the network list,
        // so a keybinding need not land on the main panel first.
        const page = rest[0] ?? "main"
        if (!openControlCenterPage(page)) return respond("control center is not built")

        const window = findWindow(WindowName.ControlCenter)
        if (window) setWindowVisible(window, true)
        return respond("control center: " + page)
      }

      case "desktop": {
        // `manifold desktop edit` toggles; `on`/`off` are for anyone who wants
        // a binding that only ever does one thing.
        const action = rest[0] ?? "edit"

        if (action === "on") setEditingDesktop(true)
        else if (action === "off") setEditingDesktop(false)
        else if (action === "edit") toggleEditingDesktop()
        else return respond(`usage: desktop [edit|on|off]`)

        return respond(`desktop editing: ${editing.get()}`)
      }

      case "pick-color":
        // Answers straight away rather than waiting for the click: the picker
        // is the compositor's, it stays up until the user is done with it, and
        // a keybinding that blocks its own IPC reply for a minute looks hung.
        void pickColor()
        return respond("picking")

      case "windows":
        return respond(app.get_windows().map((w) => w.name).join("\n"))

      case "inspector":
        // GTK's live widget/CSS inspector. Invaluable when styling.
        Gtk.Window.set_interactive_debugging(true)
        return respond("inspector opened")

      case "quit":
        ClipboardService.get_default().destroy()
        Recorder.get_default().destroy()
        unregisterWindows()
        app.quit()
        return respond("bye")

      default:
        return respond(`unknown command: ${command}\nrun "manifold help" for the list`)
    }
  },
})
