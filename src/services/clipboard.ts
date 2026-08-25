import GLib from "gi://GLib"
import Gio from "gi://Gio"
import GObject, { register, getter } from "ags/gobject"
import { execAsync, subprocess } from "ags/process"
import type AstalIO from "gi://AstalIO"

import { config } from "../config"

/**
 * What `subprocess` actually hands back.
 *
 * Not `AstalIO.Process`: the AGS wrapper returns a thinner class of the same
 * name, and typing a field with the GIR one makes the two collide.
 */
type Subprocess = ReturnType<typeof subprocess>

/**
 * Clipboard history.
 *
 * Two backends, chosen at startup:
 *
 *   - **cliphist**, when the binary is installed. It owns the storage, dedupes,
 *     caps the history and -- verified, not assumed -- refuses to record offers
 *     advertising `x-kde-passwordManagerHint`, so passwords never reach the
 *     database.
 *   - **wl-clipboard**, otherwise. Manifold keeps the history itself, which
 *     means the shell still has a working clipboard on a machine with no
 *     clipboard manager installed.
 *
 * cliphist does not watch the clipboard on its own; it needs
 * `wl-paste --watch cliphist store` running. Manifold starts that itself unless
 * `clipboard.manageDaemon` is off, so the feature works without the user having
 * to arrange a second service. Running it twice is harmless: cliphist dedupes.
 */

/**
 * Marker in the spawned daemon's command line.
 *
 * A child spawned by the shell outlives it when the shell is killed rather than
 * asked to quit, and an orphaned watcher keeps writing to the history forever.
 * Tagging the command makes those orphans findable, so startup can clear any
 * left behind by a previous crash.
 */
const DAEMON_TAG = "manifold-clipboard-daemon"

export interface ClipboardEntry {
  /** Backend-specific handle. For cliphist this is its list line. */
  id: string
  /** Single-line form shown in the list. */
  preview: string
  /**
   * Set when the entry holds an image rather than text.
   *
   * cliphist reports one as `[[ binary data 8 KiB png 107x113 ]]`, which is all
   * the metadata there is without decoding the thing.
   */
  image?: ImageEntry
}

export interface ImageEntry {
  /** `png`, `jpeg`, ... */
  type: string
  /** As cliphist wrote it: `8 KiB`, `2 MiB`. */
  size: string
  /** `107x113`. */
  dimensions: string
  /** Bytes, parsed from `size`, for deciding what is too big to decode. */
  bytes: number
}

interface Backend {
  readonly name: string
  start(): void
  stop(): void
  list(): Promise<ClipboardEntry[]>
  copy(entry: ClipboardEntry): Promise<void>
  clear(): Promise<void>
}

function has(binary: string): boolean {
  return GLib.find_program_in_path(binary) !== null
}

function collapse(text: string): string {
  const single = text.replace(/\s+/g, " ").trim()
  return single.length > 160 ? `${single.slice(0, 159)}…` : single
}

// -- cliphist ---------------------------------------------------------------

/** cliphist's stand-in for an image: `[[ binary data 8 KiB png 107x113 ]]`. */
const BINARY_PREVIEW = /^\[\[\s*binary data\s+([\d.]+)\s*(\w+)\s+(\w+)\s+(\d+x\d+)\s*\]\]$/

const UNITS: Record<string, number> = {
  B: 1,
  KiB: 1024,
  MiB: 1024 ** 2,
  GiB: 1024 ** 3,
}

/** The image an entry holds, or null when it is ordinary text. */
function parseImage(preview: string): ImageEntry | null {
  const match = BINARY_PREVIEW.exec(preview.trim())
  if (!match) return null

  const [, amount, unit, type, dimensions] = match
  return {
    type,
    size: `${amount} ${unit}`,
    dimensions,
    bytes: Number(amount) * (UNITS[unit] ?? 1),
  }
}


class CliphistBackend implements Backend {
  readonly name = "cliphist"
  private daemons: Subprocess[] = []

  start(): void {
    if (!config.get().clipboard.manageDaemon) return

    // Clear anything a previous run left behind before starting our own.
    void execAsync(["pkill", "-f", DAEMON_TAG]).catch(() => {})

    // cliphist stores text and images through separate watchers; this is the
    // arrangement its own documentation prescribes.
    for (const type of ["text", "image"]) {
      try {
        this.daemons.push(
          subprocess(
            ["sh", "-c", `exec -a ${DAEMON_TAG} wl-paste --type ${type} --watch cliphist store`],
            () => {},
            (error) => console.error(`manifold: cliphist ${type} watcher: ${error}`),
          ),
        )
      } catch (error) {
        console.error(`manifold: could not start cliphist ${type} watcher: ${error}`)
      }
    }
  }

  stop(): void {
    for (const daemon of this.daemons) daemon.kill()
    this.daemons = []
  }

  async list(): Promise<ClipboardEntry[]> {
    const output = await execAsync(["cliphist", "list"]).catch(() => "")
    if (!output) return []

    return output
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => {
        // cliphist emits "<id>\t<preview>"; the whole line is the handle its
        // own `decode` expects on stdin, so it is kept verbatim.
        const tab = line.indexOf("\t")
        const preview = tab === -1 ? line : line.slice(tab + 1)
        const image = parseImage(preview)
        return image ? { id: line, preview, image } : { id: line, preview }
      })
  }

  async copy(entry: ClipboardEntry): Promise<void> {
    // `cliphist decode` reads the list line from stdin and writes the original
    // bytes out, which go straight to wl-copy. The payload never passes through
    // a command line, so quotes and newlines in it are irrelevant.
    try {
      await pipe(["sh", "-c", "cliphist decode | wl-copy"], entry.id)
    } catch (error) {
      console.error(`manifold: could not copy: ${error}`)
    }
  }

  async clear(): Promise<void> {
    await execAsync(["cliphist", "wipe"]).catch((error) =>
      console.error(`manifold: could not wipe clipboard history: ${error}`),
    )
  }
}

/** Run a command with `input` on stdin and return its stdout. */
function pipe(argv: string[], input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const process = Gio.Subprocess.new(
      argv,
      Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE,
    )

    process.communicate_utf8_async(input, null, (source, result) => {
      try {
        const [, stdout] = source!.communicate_utf8_finish(result)
        resolve(stdout ?? "")
      } catch (error) {
        reject(error)
      }
    })
  })
}


/**
 * Put text on the clipboard.
 *
 * Through `wl-copy`'s stdin rather than its argument list, so a value that
 * begins with a dash is text and not a flag.
 */

/**
 * Decode one image entry to a file and return its path.
 *
 * The bytes cannot go through `communicate_utf8`: an image is not text, and
 * decoding it as UTF-8 mangles it. So the raw stream is written straight to a
 * file under the runtime directory, which tmpfs clears at logout.
 *
 * Files are named by entry id, so an entry that is shown again costs nothing
 * the second time.
 */
export function decodeImage(entry: ClipboardEntry): Promise<string | null> {
  if (!entry.image) return Promise.resolve(null)

  const directory = `${GLib.get_user_runtime_dir()}/manifold-clipboard`
  const id = entry.id.split("\t")[0]
  const path = `${directory}/${id}.${entry.image.type}`

  if (GLib.file_test(path, GLib.FileTest.EXISTS)) return Promise.resolve(path)

  return new Promise((resolve) => {
    try {
      GLib.mkdir_with_parents(directory, 0o700)

      const process = Gio.Subprocess.new(
        ["cliphist", "decode"],
        Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE,
      )

      process.communicate_async(
        new GLib.Bytes(new TextEncoder().encode(entry.id)),
        null,
        (source, result) => {
          try {
            const [, stdout] = source!.communicate_finish(result)
            const bytes = stdout?.get_data()
            if (!bytes || bytes.length === 0) {
              resolve(null)
              return
            }

            GLib.file_set_contents(path, bytes)
            resolve(path)
          } catch (error) {
            console.error(`manifold: could not decode a clipboard image: ${error}`)
            resolve(null)
          }
        },
      )
    } catch (error) {
      console.error(`manifold: could not decode a clipboard image: ${error}`)
      resolve(null)
    }
  })
}

export function copyText(text: string): Promise<string> {
  return pipe(["wl-copy"], text)
}

// -- wl-clipboard fallback --------------------------------------------------

const SKIP = "--manifold-skip--"

const WATCH_SCRIPT = `
  if wl-paste --list-types 2>/dev/null | grep -qi 'x-kde-passwordManagerHint'; then
    cat > /dev/null
    printf '%s\\n' '${SKIP}'
  else
    base64 -w0
    printf '\\n'
  fi
`

class WlClipboardBackend implements Backend {
  readonly name = "wl-clipboard"
  private watcher: Subprocess | null = null
  private entries: ClipboardEntry[] = []
  private texts = new Map<string, string>()

  constructor(private readonly onChange: () => void) {}

  start(): void {
    void execAsync(["pkill", "-f", DAEMON_TAG]).catch(() => {})

    try {
      this.restore()
      this.watcher = subprocess(
        ["sh", "-c", `exec -a ${DAEMON_TAG} wl-paste --type text --watch sh -c '${WATCH_SCRIPT}'`],
        (line) => this.onLine(line),
        (error) => console.error(`manifold: clipboard watcher: ${error}`),
      )
    } catch (error) {
      console.error(`manifold: clipboard watcher failed to start: ${error}`)
    }
  }

  stop(): void {
    this.watcher?.kill()
    this.watcher = null
  }

  private onLine(line: string): void {
    const payload = line.trim()
    if (!payload || payload === SKIP) return

    let text: string
    try {
      text = new TextDecoder().decode(GLib.base64_decode(payload))
    } catch {
      return
    }
    if (!text.trim()) return

    const { maxEntries, persist } = config.get().clipboard
    const id = `${GLib.DateTime.new_now_local().to_unix()}-${this.entries.length}`

    const rest = this.entries.filter((entry) => this.texts.get(entry.id) !== text)
    this.entries = [{ id, preview: collapse(text) }, ...rest].slice(0, Math.max(1, maxEntries))
    this.texts.set(id, text)

    if (persist) this.save()
    this.onChange()
  }

  async list(): Promise<ClipboardEntry[]> {
    return this.entries
  }

  async copy(entry: ClipboardEntry): Promise<void> {
    const text = this.texts.get(entry.id)
    if (text === undefined) return
    await pipe(["wl-copy"], text)
  }

  async clear(): Promise<void> {
    this.entries = []
    this.texts.clear()
    this.save()
    this.onChange()
  }

  private path(): string {
    return `${GLib.get_user_cache_dir()}/manifold/clipboard.json`
  }

  private restore(): void {
    if (!config.get().clipboard.persist) return
    const path = this.path()
    if (!GLib.file_test(path, GLib.FileTest.EXISTS)) return

    try {
      const [ok, bytes] = GLib.file_get_contents(path)
      if (!ok) return
      const saved = JSON.parse(new TextDecoder().decode(bytes)) as Array<{
        id: string
        text: string
        preview: string
      }>

      this.entries = saved.map(({ id, preview }) => ({ id, preview }))
      for (const { id, text } of saved) this.texts.set(id, text)
    } catch (error) {
      console.error(`manifold: could not read clipboard history: ${error}`)
    }
  }

  private save(): void {
    const path = this.path()
    const dir = path.slice(0, path.lastIndexOf("/"))

    try {
      // History is plain text on disk, so the directory is owner-only.
      GLib.mkdir_with_parents(dir, 0o700)
      GLib.file_set_contents(
        path,
        JSON.stringify(
          this.entries.map((entry) => ({ ...entry, text: this.texts.get(entry.id) ?? "" })),
        ),
      )
    } catch (error) {
      console.error(`manifold: could not save clipboard history: ${error}`)
    }
  }
}

// -- service ----------------------------------------------------------------

@register({ GTypeName: "ManifoldClipboard" })
export default class Clipboard extends GObject.Object {
  private static _instance: Clipboard | null = null

  static get_default(): Clipboard {
    if (!Clipboard._instance) Clipboard._instance = new Clipboard()
    return Clipboard._instance
  }

  private backend: Backend | null = null
  private _entries: ClipboardEntry[] = []

  /** Newest first. Refreshed by `reload`, which the popup calls when opened. */
  @getter(Object)
  get entries(): ClipboardEntry[] {
    return this._entries
  }

  /** False when neither backend is usable, so the module can hide itself. */
  @getter(Boolean)
  get available(): boolean {
    return this.backend !== null
  }

  /** Which backend answered, for logs and for the popup's empty state. */
  @getter(String)
  get backendName(): string {
    return this.backend?.name ?? "none"
  }

  constructor() {
    super()

    if (has("cliphist")) {
      this.backend = new CliphistBackend()
    } else if (has("wl-paste")) {
      this.backend = new WlClipboardBackend(() => void this.reload())
    } else {
      console.log("manifold: no clipboard history (neither cliphist nor wl-clipboard found)")
      return
    }

    console.log(`manifold: clipboard history via ${this.backend.name}`)
    this.backend.start()
    void this.reload()
  }

  /** Re-read the history from the backend. */
  async reload(): Promise<void> {
    if (!this.backend) return
    this._entries = await this.backend.list()
    this.notify("entries")
  }

  async copy(entry: ClipboardEntry): Promise<void> {
    await this.backend?.copy(entry)
  }

  async clear(): Promise<void> {
    await this.backend?.clear()
    await this.reload()
  }

  destroy(): void {
    this.backend?.stop()
    this.backend = null
  }
}
