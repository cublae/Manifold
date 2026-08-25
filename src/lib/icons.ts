import GLib from "gi://GLib"
import Gdk from "gi://Gdk?version=4.0"
import { Gtk } from "ags/gtk4"

/**
 * Icon names that differ between themes.
 *
 * Names are not as portable as the freedesktop spec suggests. Adwaita 50 has no
 * plain `notification-symbolic` and keeps the bell under its Settings-panel
 * name, while Tela, Papirus and Breeze all ship the plain one. Picking a single
 * name means a missing-image square on half the systems, so the theme is asked
 * instead and the first name it actually has wins.
 */

/** First name the current icon theme has, or the last one as a last resort. */
export function firstIcon(...names: string[]): string {
  const display = Gdk.Display.get_default()
  if (display) {
    const theme = Gtk.IconTheme.get_for_display(display)
    for (const name of names) {
      if (theme.has_icon(name)) return name
    }
  }
  return names[names.length - 1] ?? ""
}

/**
 * The plus that adds something to a list.
 *
 * The plain name comes first, which is backwards from every other lookup here
 * and deliberate: Tela ships a `list-add-symbolic` that GTK4 loads without
 * complaint and then draws as nothing at all, while its plain `list-add` is
 * fine. Adwaita has only the symbolic one, and that one does draw, so asking
 * for the plain name first lands on something visible either way.
 */
export function addIcon(): string {
  return firstIcon("list-add", "list-add-symbolic")
}

/**
 * The notification bell, quiet or not.
 *
 * Resolved per call rather than once at import: the display does not exist
 * until the application is running, and the icon theme can change under us.
 */
export function bellIcon(quiet: boolean): string {
  return quiet
    ? firstIcon("notification-disabled-symbolic", "notifications-disabled-symbolic")
    : firstIcon("notification-symbolic", "preferences-system-notifications-symbolic")
}

/**
 * An image for whatever a desktop entry, a window or a stream calls its icon.
 *
 * `Icon=` is a themed name *or* an absolute path -- the spec allows both, and
 * Steam games, AppImages and a fair number of packaged applications use the
 * path form. Handing a path to `icon-name` gets nothing back but the
 * broken-image square, and so does a themed name the user's icon set does not
 * carry, which is easy to hit on a theme like Tela that covers the popular
 * applications and no more.
 *
 * So: a path is loaded as a file, a name is used only if the theme has it, and
 * anything else falls back to something that at least draws.
 */
export function appImage(icon: string | null | undefined, size: number, fallback: string): Gtk.Image {
  const image = new Gtk.Image({ pixelSize: size })
  const name = icon?.trim()

  if (!name) {
    image.set_from_icon_name(fallback)
    return image
  }

  if (name.startsWith("/")) {
    if (GLib.file_test(name, GLib.FileTest.EXISTS)) image.set_from_file(name)
    else image.set_from_icon_name(fallback)
    return image
  }

  // `foo.png` in an entry usually means the themed icon `foo`.
  const bare = name.replace(/\.(png|svg|xpm)$/i, "")

  image.set_from_icon_name(firstIcon(name, bare, fallback))
  return image
}
