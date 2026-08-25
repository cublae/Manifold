import GLib from "gi://GLib"
import Gio from "gi://Gio"

import type { NiriReply, NiriRequest } from "./niri.types"

/**
 * Low-level transport for the niri IPC socket.
 *
 * The protocol is newline-delimited JSON over a unix stream socket whose path
 * lives in `$NIRI_SOCKET`:
 *
 *   -> `"Workspaces"\n`
 *   <- `{"Ok":{"Workspaces":[...]}}\n`   (connection then closes)
 *
 * `"EventStream"` is the exception: niri answers `{"Ok":"Handled"}` and then
 * keeps the connection open, pushing one JSON event per line indefinitely.
 *
 * Every request needs its own connection -- niri does not multiplex.
 */

export class NiriSocketError extends Error {}

export function socketPath(): string {
  const path = GLib.getenv("NIRI_SOCKET")
  if (!path) {
    throw new NiriSocketError(
      "NIRI_SOCKET is not set. Manifold must be started from inside a niri session.",
    )
  }
  return path
}

/** Whether we are plausibly running under niri. Cheap, never throws. */
export function isAvailable(): boolean {
  return GLib.getenv("NIRI_SOCKET") !== null
}

function connect(cancellable: Gio.Cancellable | null): Promise<Gio.SocketConnection> {
  const client = new Gio.SocketClient()
  const address = Gio.UnixSocketAddress.new(socketPath())

  return new Promise((resolve, reject) => {
    client.connect_async(address, cancellable, (_source, res) => {
      try {
        resolve(client.connect_finish(res))
      } catch (error) {
        reject(error)
      }
    })
  })
}

function writeRequest(conn: Gio.SocketConnection, request: NiriRequest): void {
  const payload = new TextEncoder().encode(`${JSON.stringify(request)}\n`)
  // Blocking, but a single short line into a local socket buffer never stalls.
  conn.get_output_stream().write_all(payload, null)
}

function readLine(stream: Gio.DataInputStream, cancellable: Gio.Cancellable | null): Promise<string | null> {
  return new Promise((resolve, reject) => {
    stream.read_line_async(GLib.PRIORITY_DEFAULT, cancellable, (_source, res) => {
      try {
        const [line] = stream.read_line_finish_utf8(res)
        resolve(line ?? null)
      } catch (error) {
        reject(error)
      }
    })
  })
}

function unwrap<T>(line: string): T {
  const reply = JSON.parse(line) as NiriReply<T>
  if ("Err" in reply) throw new NiriSocketError(`niri rejected the request: ${reply.Err}`)
  if (!("Ok" in reply)) throw new NiriSocketError(`unexpected reply from niri: ${line}`)
  return reply.Ok
}

/**
 * Issue a one-shot request and resolve with the unwrapped `Ok` payload.
 *
 * Responses are externally tagged the same way requests are, so `Workspaces`
 * resolves to `{ Workspaces: [...] }`; callers pick the field they asked for.
 */
export async function request<T = unknown>(
  req: NiriRequest,
  cancellable: Gio.Cancellable | null = null,
): Promise<T> {
  const conn = await connect(cancellable)
  try {
    writeRequest(conn, req)
    const stream = new Gio.DataInputStream({ base_stream: conn.get_input_stream() })
    const line = await readLine(stream, cancellable)
    if (line === null) throw new NiriSocketError("niri closed the connection without replying")
    return unwrap<T>(line)
  } finally {
    conn.close(null)
  }
}

/** Fire an action and ignore the `"Handled"` acknowledgement. */
export async function action(act: NiriRequest extends never ? never : Extract<NiriRequest, { Action: unknown }>["Action"]): Promise<void> {
  await request({ Action: act })
}

export interface EventStreamHandlers {
  /** Called once per event line, already JSON-parsed. */
  onEvent: (event: unknown) => void
  /** Called after the handshake succeeds. */
  onConnected?: () => void
  /** Called when the stream ends, for any reason. `error` is null on clean EOF. */
  onDisconnected?: (error: unknown | null) => void
}

/**
 * An `"EventStream"` connection that reads lines until cancelled or closed.
 *
 * Reconnection is deliberately *not* handled here -- see `NiriService`, which
 * owns the backoff policy so the transport stays a dumb pipe.
 */
export class EventStream {
  private cancellable = new Gio.Cancellable()
  private conn: Gio.SocketConnection | null = null
  private closed = false

  constructor(private readonly handlers: EventStreamHandlers) {}

  async open(): Promise<void> {
    try {
      this.conn = await connect(this.cancellable)
      writeRequest(this.conn, "EventStream")

      const stream = new Gio.DataInputStream({ base_stream: this.conn.get_input_stream() })

      // niri acknowledges the subscription before any event arrives.
      const handshake = await readLine(stream, this.cancellable)
      if (handshake === null) throw new NiriSocketError("niri closed the event stream during handshake")
      unwrap(handshake)

      this.handlers.onConnected?.()
      await this.pump(stream)
      this.finish(null)
    } catch (error) {
      if (this.closed) return
      this.finish(error)
    }
  }

  private async pump(stream: Gio.DataInputStream): Promise<void> {
    while (!this.closed) {
      const line = await readLine(stream, this.cancellable)
      if (line === null) return // clean EOF: niri exited or dropped us
      if (line.trim() === "") continue

      try {
        this.handlers.onEvent(JSON.parse(line))
      } catch (error) {
        // A malformed or unrecognised line must not tear down the stream.
        console.error(`manifold: could not handle niri event: ${error}`)
      }
    }
  }

  private finish(error: unknown | null): void {
    if (this.closed) return
    this.closed = true
    try {
      this.conn?.close(null)
    } catch {
      // Already closed by the peer; nothing useful to do.
    }
    this.conn = null
    this.handlers.onDisconnected?.(error)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.cancellable.cancel()
    try {
      this.conn?.close(null)
    } catch {
      // ignored
    }
    this.conn = null
  }
}
