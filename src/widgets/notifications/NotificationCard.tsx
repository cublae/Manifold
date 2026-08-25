import Gdk from "gi://Gdk?version=4.0"
import GdkPixbuf from "gi://GdkPixbuf?version=2.0"
import GLib from "gi://GLib"
import Pango from "gi://Pango"
import { Gtk } from "ags/gtk4"
import { createPoll } from "ags/time"
import { _, language, plural } from "../../lib/i18n"

import type AstalNotifdNS from "gi://AstalNotifd"

import { appImage } from "../../lib/icons"

/**
 * One notification, shared by the popups and the notification centre.
 *
 * Notifications carry an image in one of several forms -- a raw path, a themed
 * icon name, or an app icon -- so the card probes them in order of specificity
 * rather than assuming one.
 */

export interface NotificationCardProps {
  notification: AstalNotifdNS.Notification
  /** Urgency enum, passed in so this file need not import the library. */
  urgency: typeof AstalNotifdNS.Urgency
  /** Called when the user dismisses the card. */
  onDismiss?: () => void
  /** Compact styling for the popup form. */
  compact?: boolean
}

/** Thumbnail box for notifications that ship a picture. */
const THUMB_WIDTH = 76
const THUMB_HEIGHT = 54

/**
 * Drives the age labels. Half a minute is fine: the wording never gets finer
 * than whole minutes, so a shorter tick would only redraw the same text.
 */
const tick = createPoll(0, 30_000, (n: number) => n + 1)

/**
 * Ages, in whichever language and with whichever plural rules apply.
 *
 * The three Russian forms are why this cannot be a table of strings: "1 минуту
 * назад", "2 минуты назад", "5 минут назад", and everything in the teens takes
 * the third. English has two forms and a suffix, which is the degenerate case
 * of the same shape.
 */
function age(count: number, unit: "minute" | "hour" | "day"): string {
  const forms: Record<typeof unit, [string, string, string]> =
    language() === "ru"
      ? {
          minute: ["минуту", "минуты", "минут"],
          hour: ["час", "часа", "часов"],
          day: ["день", "дня", "дней"],
        }
      : {
          minute: ["minute", "minutes", "minutes"],
          hour: ["hour", "hours", "hours"],
          day: ["day", "days", "days"],
        }

  const word = plural(count, forms[unit])
  return language() === "ru" ? `${count} ${word} назад` : `${count} ${word} ago`
}

/** Human-readable age, the way notification centres label their entries. */
function relativeTime(unixSeconds: number): string {
  const now = GLib.DateTime.new_now_local().to_unix()
  const delta = Math.max(0, now - unixSeconds)

  if (delta < 60) return _("just now")
  if (delta < 3600) return age(Math.floor(delta / 60), "minute")
  if (delta < 86400) return age(Math.floor(delta / 3600), "hour")
  return age(Math.floor(delta / 86400), "day")
}

/**
 * Load an image already scaled to the thumbnail box.
 *
 * The scaling has to happen at load time, not in the widget. `set_size_request`
 * sets a *minimum*, and `Gtk.Picture` asks for the image's own size as its
 * natural one -- so a notification carrying a 512-pixel avatar, which is what
 * Telegram attaches, made the card demand 512 pixels of width and squeezed the
 * text into whatever was left. `ContentFit.COVER` does not help: it decides how
 * the image is painted inside an allocation, not how large one is asked for.
 *
 * Scaled to *cover* the box and then cropped to it, so the result is exactly
 * the thumbnail size whatever came in -- a square avatar and a widescreen
 * screenshot give the same shaped card. Reading the header first means a large
 * source is never decoded at full size just to be thrown away.
 */
function thumbnail(path: string): Gdk.Texture | null {
  try {
    const [, width, height] = GdkPixbuf.Pixbuf.get_file_info(path)
    if (!width || !height) return null

    // Smaller than the box is not a picture, it is an icon. Blowing a 24-pixel
    // square up to 76 is ugly, and a small texture in a Picture is worse than
    // ugly: `set_size_request` only raises the *minimum*, so the widget still
    // asks for a height derived from the image and the card grows anyway.
    // Those go to the icon path instead, which has a real fixed size.
    if (width < THUMB_WIDTH || height < THUMB_HEIGHT) return null

    const scale = Math.max(THUMB_WIDTH / width, THUMB_HEIGHT / height)
    const loaded = GdkPixbuf.Pixbuf.new_from_file_at_scale(
      path,
      Math.max(THUMB_WIDTH, Math.round(width * scale)),
      Math.max(THUMB_HEIGHT, Math.round(height * scale)),
      true,
    )
    if (!loaded) return null

    // Centre crop, so the texture is exactly the box and the widget has
    // nothing left to decide.
    const cropped = loaded.new_subpixbuf(
      Math.floor((loaded.get_width() - THUMB_WIDTH) / 2),
      Math.floor((loaded.get_height() - THUMB_HEIGHT) / 2),
      THUMB_WIDTH,
      THUMB_HEIGHT,
    )

    return cropped ? Gdk.Texture.new_for_pixbuf(cropped) : null
  } catch (error) {
    console.error(`manifold: could not read the notification image ${path}: ${error}`)
    return null
  }
}

/**
 * The picture or icon shown beside the text.
 *
 * A real image gets a fixed, cropped thumbnail so that cards keep a common
 * shape whatever the source resolution; icon names stay square and unclipped.
 */
function Thumbnail(n: AstalNotifdNS.Notification): Gtk.Widget {
  const image = n.image

  if (image && GLib.file_test(image, GLib.FileTest.EXISTS)) {
    const texture = thumbnail(image)

    if (texture) {
      // The texture is already exactly the thumbnail box, so there is no
      // fitting left to do and no way for the card to be stretched by it.
      const picture = Gtk.Picture.new_for_paintable(texture)
      picture.set_can_shrink(false)
      picture.set_halign(Gtk.Align.START)
      picture.set_valign(Gtk.Align.START)
      // GTK4 has no CSS `overflow`, so the rounded corners are clipped by the
      // widget property instead.
      picture.set_overflow(Gtk.Overflow.HIDDEN)
      picture.add_css_class("manifold-notification-image")
      return picture
    }
    // Too small to crop, or unreadable: shown as an icon rather than stretched.
  }

  const name = image || n.appIcon || n.desktopEntry
  const icon = appImage(name, 32, "dialog-information-symbolic")
  icon.set_valign(Gtk.Align.START)
  return icon
}

export default function NotificationCard({
  notification: n,
  urgency,
  onDismiss,
  compact = false,
}: NotificationCardProps): Gtk.Widget {
  const classes = ["manifold-notification"]
  if (compact) classes.push("popup")
  if (n.urgency === urgency.CRITICAL) classes.push("critical")
  else if (n.urgency === urgency.LOW) classes.push("low")

  const header = (
    <box cssClasses={["header"]} spacing={6}>
      <label cssClasses={["app-name"]} label={n.appName || _("Notification")} />
      <label
        cssClasses={["time", "dim"]}
        hexpand
        halign={Gtk.Align.END}
        label={tick(() => relativeTime(n.time))}
      />
      <button
        cssClasses={["close", "flat"]}
        tooltipText={_("Dismiss")}
        valign={Gtk.Align.CENTER}
        onClicked={() => {
          n.dismiss()
          onDismiss?.()
        }}
      >
        <image iconName="window-close-symbolic" pixelSize={12} />
      </button>
    </box>
  ) as Gtk.Widget

  // Caps the *natural* width, so a card asks for a sensible size rather than
  // one long line, and lets the column fill whatever width it is given.
  //
  // Note the deliberate absence of `halign`: a box measures a child's height
  // for the box's own width, but a child with `halign: START` is then
  // allocated only its natural width. A wrapping label caught between the two
  // wraps onto a line there is no room for and runs over the label above it.
  // `xalign` puts the text on the left without shrinking the allocation.
  const COLUMN_CHARS = 24

  const text = (
    <box orientation={Gtk.Orientation.VERTICAL} spacing={2} hexpand>
      <label
        cssClasses={["summary"]}
        xalign={0}
        wrap
        wrapMode={Pango.WrapMode.WORD_CHAR}
        maxWidthChars={COLUMN_CHARS}
        visible={Boolean(n.summary)}
        label={n.summary || ""}
      />
      <label
        cssClasses={["body", "dim"]}
        xalign={0}
        wrap
        // Bodies are often file paths, which have no spaces to break on.
        wrapMode={Pango.WrapMode.WORD_CHAR}
        maxWidthChars={COLUMN_CHARS}
        visible={Boolean(n.body)}
        // Notification bodies may contain a restricted subset of markup.
        useMarkup
        label={n.body || ""}
      />
    </box>
  ) as Gtk.Widget

  const card = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 6,
    cssClasses: classes,
  })
  card.append(header)

  const content = new Gtk.Box({
    orientation: Gtk.Orientation.HORIZONTAL,
    spacing: 10,
    cssClasses: ["content"],
  })
  content.append(Thumbnail(n))
  content.append(text)
  card.append(content)

  // Actions are app-defined buttons; invoking one usually also closes the
  // notification, which the daemon reports back as a `resolved` signal.
  //
  // `default` is not one of them: the spec reserves it for "the user activated
  // the notification itself", so apps send it with no label and expect a click
  // on the body. Drawn as a button it is an empty box.
  const actions = n.actions.filter((action) => action.id !== "default" && action.label)

  if (actions.length > 0) {
    const row = new Gtk.Box({
      orientation: Gtk.Orientation.HORIZONTAL,
      spacing: 6,
      homogeneous: true,
      cssClasses: ["actions"],
    })

    for (const action of actions) {
      row.append(
        (
          <button cssClasses={["action"]} onClicked={() => n.invoke(action.id)}>
            <label label={action.label} />
          </button>
        ) as Gtk.Widget,
      )
    }
    card.append(row)
  }

  return card
}
