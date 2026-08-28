import Gio from "gi://Gio"
import GLib from "gi://GLib"
import GdkPixbuf from "gi://GdkPixbuf"

/**
 * Reading a tray item that AstalTray registered but cannot talk to.
 *
 * The StatusNotifierItem spec lets an application register either a bus name
 * or an object path, and Chromium-based applications register a path. Astal
 * composes its item ids as name + path and, for those, ends up with a path
 * that has an extra `/StatusNotifierItem` glued on -- an object that does not
 * exist, so every property it reads comes back empty and the item arrives with
 * no icon, no id and no title. vesktop is the common case.
 *
 * Rather than let those items vanish, the real object is found by walking back
 * up the recorded path, and its icon read here. Everything in this file talks
 * to the item directly; nothing of Astal's is involved once we are past the
 * point where Astal gave up.
 */

const ITEM = "org.kde.StatusNotifierItem"
const PROPERTIES = "org.freedesktop.DBus.Properties"

/** How long to wait on an application that registered a tray icon, in ms. */
const TIMEOUT_MS = 2000

function bus(): Gio.DBusConnection | null {
  try {
    return Gio.DBus.session
  } catch (error) {
    console.error(`manifold: no session bus for the tray: ${error}`)
    return null
  }
}

/** Split an Astal item id, which is a bus name with the object path appended. */
function split(itemId: string): { name: string; path: string } | null {
  const slash = itemId.indexOf("/")
  if (slash <= 0) return null

  const name = itemId.slice(0, slash)
  const path = itemId.slice(slash)
  return path.startsWith("/") ? { name, path } : null
}

/**
 * Paths worth trying, nearest first.
 *
 * The recorded one comes first because for a well-behaved item it is already
 * right; then each shorter prefix, which is where the extra segment Astal
 * appended is shed; then the default from the spec, for an item whose path was
 * lost entirely.
 */
function candidates(path: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []

  const add = (candidate: string) => {
    if (!seen.has(candidate)) {
      seen.add(candidate)
      out.push(candidate)
    }
  }

  add(path)

  const segments = path.split("/").filter(Boolean)
  for (let i = segments.length - 1; i > 0; i -= 1) add(`/${segments.slice(0, i).join("/")}`)

  add("/StatusNotifierItem")
  return out
}

function getProperty(
  connection: Gio.DBusConnection,
  name: string,
  path: string,
  property: string,
): Promise<GLib.Variant | null> {
  return new Promise((resolve) => {
    connection.call(
      name,
      path,
      PROPERTIES,
      "Get",
      new GLib.Variant("(ss)", [ITEM, property]),
      new GLib.VariantType("(v)"),
      Gio.DBusCallFlags.NONE,
      TIMEOUT_MS,
      null,
      (self, result) => {
        try {
          // A missing property is an error, not an empty answer, and it is the
          // normal reply from a path that holds no item at all.
          const reply = self?.call_finish(result)
          resolve(reply ? (reply.get_child_value(0).get_variant() ?? null) : null)
        } catch {
          resolve(null)
        }
      },
    )
  })
}

async function getString(
  connection: Gio.DBusConnection,
  name: string,
  path: string,
  property: string,
): Promise<string> {
  const value = await getProperty(connection, name, path, property)
  return value?.get_type_string() === "s" ? (value.get_string()[0] ?? "") : ""
}

/**
 * Turn the spec's `a(iiay)` into a pixbuf.
 *
 * The bytes are ARGB32 in network byte order, which is neither what GdkPixbuf
 * wants nor what any pixel format on this machine is, so they are rotated into
 * RGBA one pixel at a time. Applications send several sizes; the largest is
 * taken and left for GTK to scale, since scaling down looks better than up.
 */
function pixbuf(value: GLib.Variant): GdkPixbuf.Pixbuf | null {
  let frames: Array<[number, number, Uint8Array]>
  try {
    frames = value.deep_unpack() as Array<[number, number, Uint8Array]>
  } catch (error) {
    console.error(`manifold: unreadable tray pixmap: ${error}`)
    return null
  }

  let best: [number, number, Uint8Array] | null = null
  for (const frame of frames) {
    const [width, height, data] = frame
    if (width <= 0 || height <= 0) continue
    if (data.length < width * height * 4) continue
    if (!best || width * height > best[0] * best[1]) best = frame
  }
  if (!best) return null

  const [width, height, argb] = best
  const rgba = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i += 1) {
    const at = i * 4
    rgba[at] = argb[at + 1]
    rgba[at + 1] = argb[at + 2]
    rgba[at + 2] = argb[at + 3]
    rgba[at + 3] = argb[at]
  }

  try {
    return GdkPixbuf.Pixbuf.new_from_bytes(
      new GLib.Bytes(rgba),
      GdkPixbuf.Colorspace.RGB,
      true,
      8,
      width,
      height,
      width * 4,
    )
  } catch (error) {
    console.error(`manifold: could not build a tray icon: ${error}`)
    return null
  }
}

/** An item reached directly, once Astal's own proxy has come up empty. */
export class FallbackItem {
  private constructor(
    private readonly connection: Gio.DBusConnection,
    private readonly name: string,
    private readonly path: string,
  ) {}

  /**
   * Find the object behind an item id, or null if none of the candidates
   * answers. `Status` is the probe: every item has it, and unlike `Id` an
   * empty answer cannot be confused with a live object that left it unset.
   */
  static async locate(itemId: string): Promise<FallbackItem | null> {
    const connection = bus()
    const parts = split(itemId)
    if (!connection || !parts) return null

    for (const path of candidates(parts.path)) {
      const status = await getProperty(connection, parts.name, path, "Status")
      if (status) return new FallbackItem(connection, parts.name, path)
    }
    return null
  }

  /** The item's icon, by name if it gives one and by pixmap otherwise. */
  async icon(): Promise<Gio.Icon | null> {
    const name = await getString(this.connection, this.name, this.path, "IconName")
    if (name) {
      const themePath = await getString(this.connection, this.name, this.path, "IconThemePath")
      if (themePath) {
        // An application shipping its own icon directory is telling us the
        // name will not be found in any installed theme.
        for (const extension of ["png", "svg"]) {
          const file = Gio.File.new_for_path(`${themePath}/${name}.${extension}`)
          if (file.query_exists(null)) return new Gio.FileIcon({ file })
        }
      }
      return new Gio.ThemedIcon({ name })
    }

    const pixmap = await getProperty(this.connection, this.name, this.path, "IconPixmap")
    return pixmap ? pixbuf(pixmap) : null
  }

  /** Whatever the item is willing to be called, for the tooltip. */
  async label(): Promise<string> {
    const title = await getString(this.connection, this.name, this.path, "Title")
    return title || (await getString(this.connection, this.name, this.path, "Id"))
  }

  /** Fire and forget: a tray click is not something to report failure of. */
  private send(method: string, x: number, y: number): void {
    this.connection.call(
      this.name,
      this.path,
      ITEM,
      method,
      new GLib.Variant("(ii)", [x, y]),
      null,
      Gio.DBusCallFlags.NONE,
      TIMEOUT_MS,
      null,
      null,
    )
  }

  activate(x: number, y: number): void {
    this.send("Activate", x, y)
  }

  secondaryActivate(x: number, y: number): void {
    this.send("SecondaryActivate", x, y)
  }

  /**
   * Ask the application to put up its own menu.
   *
   * Items reached this way have no menu model for us to build a popover from
   * -- that is the same missing proxy -- so the menu has to be the
   * application's own window.
   */
  contextMenu(x: number, y: number): void {
    this.send("ContextMenu", x, y)
  }

  /** Watch for the item swapping its icon, e.g. an unread badge appearing. */
  subscribe(onChange: () => void): () => void {
    const ids = ["NewIcon", "NewStatus", "NewTitle"].map((signal) =>
      this.connection.signal_subscribe(
        this.name,
        ITEM,
        signal,
        this.path,
        null,
        Gio.DBusSignalFlags.NONE,
        () => onChange(),
      ),
    )

    return () => {
      for (const id of ids) this.connection.signal_unsubscribe(id)
    }
  }
}
