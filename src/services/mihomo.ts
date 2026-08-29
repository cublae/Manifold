import GLib from "gi://GLib"
import { createState, type Accessor } from "ags"

import { request } from "../lib/http"

/**
 * The mihomo proxy core, as far as a shell needs to know it.
 *
 * MihomoManifold -- the GTK front-end that owns the core -- keeps its settings
 * in a plain JSON file, and the core itself answers on the standard Clash
 * external controller. Both belong to the same user as the shell, so nothing
 * here needs a helper or a privileged path: the address and the secret are read
 * from that file, and everything else is HTTP against loopback.
 *
 * Deliberately not a copy of the front-end. What belongs in a panel is the
 * handful of things you reach for without opening an application: is traffic
 * going through the proxy at all, which node is carrying it, and is that node
 * still fast. Subscriptions, routing rules and the log stay where they are.
 */

/** Where the front-end keeps its settings. */
function configPath(): string {
  return GLib.build_filenamev([GLib.get_user_config_dir(), "mihomo-manifold", "config.json"])
}

interface Settings {
  base: string
  secret: string
}

interface StoredConfig {
  core?: {
    controller_host?: string
    controller_port?: number
    secret?: string
  }
}

function readSettings(): Settings | null {
  const path = configPath()
  if (!GLib.file_test(path, GLib.FileTest.EXISTS)) return null

  try {
    const [ok, contents] = GLib.file_get_contents(path)
    if (!ok) return null

    const parsed = JSON.parse(new TextDecoder().decode(contents)) as StoredConfig
    const core = parsed.core
    if (!core) return null

    const host = core.controller_host || "127.0.0.1"
    const port = core.controller_port || 9097
    return { base: `http://${host}:${port}`, secret: core.secret ?? "" }
  } catch (error) {
    console.error(`manifold: unreadable mihomo config: ${error}`)
    return null
  }
}

/** How the core routes traffic. `direct` is the closest thing it has to off. */
export type Mode = "rule" | "global" | "direct"

export interface Node {
  name: string
  /** Milliseconds from the last test, or null if it has not been tested. */
  delay: number | null
}

export interface Group {
  name: string
  /** Selector groups can be pointed at a node; the rest choose for themselves. */
  selectable: boolean
  now: string
  nodes: Node[]
}

export interface Status {
  /** The front-end is installed, so the tile has a reason to exist. */
  configured: boolean
  /** The core is up and answering. */
  running: boolean
  version: string
  mode: Mode
  groups: Group[]
}

const OFFLINE: Status = {
  configured: false,
  running: false,
  version: "",
  mode: "rule",
  groups: [],
}

/** Group types that answer to a selection; the others pick their own node. */
const SELECTABLE = new Set(["Selector"])
const GROUPS = new Set(["Selector", "URLTest", "Fallback", "LoadBalance", "Relay"])

interface ProxyEntry {
  type: string
  now?: string
  all?: string[]
  history?: Array<{ delay: number }>
}

const [status, setStatus] = createState<Status>(OFFLINE)

/** What the panel reads. Never throws, never blocks: it is a poll result. */
export const state: Accessor<Status> = status

function api(settings: Settings, path: string, options: Parameters<typeof request>[1] = {}) {
  return request(`${settings.base}${path}`, {
    ...options,
    headers: {
      ...(options.headers ?? {}),
      // An empty secret is a valid configuration -- the header is simply left
      // off then, which is what the core expects.
      ...(settings.secret ? { Authorization: `Bearer ${settings.secret}` } : {}),
    },
  })
}

function delayOf(entry: ProxyEntry): number | null {
  const last = entry.history?.[entry.history.length - 1]
  // The core reports an unreachable node as a zero rather than omitting it.
  return last && last.delay > 0 ? last.delay : null
}

async function read(settings: Settings): Promise<Status> {
  const version = JSON.parse(await api(settings, "/version")) as { version?: string }
  const configs = JSON.parse(await api(settings, "/configs")) as { mode?: string }
  const proxies = JSON.parse(await api(settings, "/proxies")) as {
    proxies?: Record<string, ProxyEntry>
  }

  const entries = proxies.proxies ?? {}
  const groups: Group[] = []

  for (const [name, entry] of Object.entries(entries)) {
    if (!GROUPS.has(entry.type)) continue

    groups.push({
      name,
      selectable: SELECTABLE.has(entry.type),
      now: entry.now ?? "",
      nodes: (entry.all ?? []).map((node) => ({
        name: node,
        delay: entries[node] ? delayOf(entries[node]) : null,
      })),
    })
  }

  return {
    configured: true,
    running: true,
    version: version.version ?? "",
    mode: (configs.mode as Mode) ?? "rule",
    groups,
  }
}

/**
 * Refresh the state.
 *
 * A core that is not running is the ordinary case, not an error: the front-end
 * only starts it when asked. So an unreachable controller means "off", and only
 * a missing config file means "not installed".
 */
export async function refresh(): Promise<void> {
  const settings = readSettings()
  if (!settings) {
    setStatus(OFFLINE)
    return
  }

  try {
    setStatus(await read(settings))
  } catch {
    setStatus({ ...OFFLINE, configured: true })
  }
}

/**
 * The node worth naming on a tile.
 *
 * A subscription usually has one group the rules actually point at and a
 * couple of helpers behind it. `PROXY` is what every generated profile calls
 * that group, so it is preferred by name, and the first group that can be
 * selected is the fallback for profiles that call it something else.
 */
export function currentNode(status: Status): string {
  const named = status.groups.find((group) => group.name === "PROXY")
  const chosen = named ?? status.groups.find((group) => group.selectable) ?? status.groups[0]
  return chosen?.now ?? ""
}

let timer: number | null = null
let watchers = 0

/**
 * Poll while someone is looking.
 *
 * The core is started and stopped by its own front-end, and answers no signal
 * a shell could subscribe to, so its state has to be asked for. Asking every
 * few seconds forever would be waste: the returned function stops the timer
 * once the last caller is gone, and the panel calls it when it closes.
 */
export function poll(intervalSeconds = 5): () => void {
  void refresh()
  watchers += 1

  timer ??= GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, intervalSeconds, () => {
    void refresh()
    return GLib.SOURCE_CONTINUE
  })

  let stopped = false
  return () => {
    if (stopped) return
    stopped = true
    watchers -= 1

    if (watchers === 0 && timer !== null) {
      GLib.source_remove(timer)
      timer = null
    }
  }
}

/** Point a selector group at one of its nodes. */
export async function select(group: string, node: string): Promise<void> {
  const settings = readSettings()
  if (!settings) return

  await api(settings, `/proxies/${encodeURIComponent(group)}`, {
    method: "PUT",
    json: { name: node },
  })
  await refresh()
}

/** Switch how the core routes traffic. */
export async function setMode(mode: Mode): Promise<void> {
  const settings = readSettings()
  if (!settings) return

  await api(settings, "/configs", { method: "PATCH", json: { mode } })
  await refresh()
}

/**
 * Time every node in a group.
 *
 * The core tests them in parallel and answers with the ones that responded, so
 * this takes about as long as the timeout and is worth showing progress for.
 */
export async function testGroup(group: string, timeout = 3000): Promise<void> {
  const settings = readSettings()
  if (!settings) return

  const url =
    `/group/${encodeURIComponent(group)}/delay` +
    `?timeout=${timeout}&url=${encodeURIComponent("http://www.gstatic.com/generate_204")}`

  await api(settings, url)
  await refresh()
}
