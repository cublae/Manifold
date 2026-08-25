import GLib from "gi://GLib"

/**
 * Applications the user pinned to the top of the launcher.
 *
 * The launcher already ranks an empty query by how often something is
 * launched, which AstalApps counts for us. That answers "what do I open a lot",
 * not "what do I want in the same place every time" -- a terminal that gets
 * opened forty times a day and a password manager that gets opened twice both
 * belong at the top, and only the first one earns its way there. Pins are the
 * second answer, and they sit above the counted ones.
 *
 * Kept in the state directory rather than the cache: a cache is something the
 * user may delete to reclaim space, and losing a launch counter to that is a
 * shrug, while losing a list somebody arranged by hand is not.
 */

/** Desktop file ids, e.g. `firefox.desktop`, in the order they were pinned. */
let pinned: string[] | null = null

const listeners = new Set<() => void>()

function path(): string {
  return `${GLib.get_user_state_dir()}/manifold/pinned.json`
}

function load(): string[] {
  const file = path()
  if (!GLib.file_test(file, GLib.FileTest.EXISTS)) return []

  try {
    const [ok, bytes] = GLib.file_get_contents(file)
    if (!ok) return []

    const saved: unknown = JSON.parse(new TextDecoder().decode(bytes))
    if (!Array.isArray(saved)) return []

    return saved.filter((entry): entry is string => typeof entry === "string")
  } catch (error) {
    console.error(`manifold: could not read the pinned applications: ${error}`)
    return []
  }
}

function save(): void {
  const file = path()

  try {
    GLib.mkdir_with_parents(file.slice(0, file.lastIndexOf("/")), 0o700)
    GLib.file_set_contents(file, JSON.stringify(pinned ?? []))
  } catch (error) {
    console.error(`manifold: could not save the pinned applications: ${error}`)
  }
}

/** Desktop file ids, in pin order. */
export function pinnedIds(): string[] {
  if (!pinned) pinned = load()
  return pinned
}

export function isPinned(entry: string | null | undefined): boolean {
  return Boolean(entry) && pinnedIds().includes(entry as string)
}

/**
 * Pin or unpin an application.
 *
 * New pins go on the end, so pinning something never moves what is already
 * there -- the whole point of a pin is that it stays where it was put.
 */
export function togglePin(entry: string | null | undefined): void {
  if (!entry) return

  const list = pinnedIds()
  const at = list.indexOf(entry)
  if (at === -1) list.push(entry)
  else list.splice(at, 1)

  save()
  for (const listener of listeners) listener()
}

export function onPinnedChanged(listener: () => void): void {
  listeners.add(listener)
}
