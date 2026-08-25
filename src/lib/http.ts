import GLib from "gi://GLib"
import Soup from "gi://Soup?version=3.0"

/**
 * The one HTTPS request the shell makes.
 *
 * libsoup rather than `Gio.File.new_for_uri`: that route works only where a
 * GVfs http backend happens to be installed, which is true of a desktop session
 * and not of a wrapped Nix closure. libsoup is a declared dependency and
 * behaves the same everywhere.
 *
 * One session is kept for the process. Sessions hold the connection pool, and
 * building a new one per request throws away every kept-alive connection.
 */

let session: Soup.Session | null = null

function shared(): Soup.Session {
  session ??= new Soup.Session({ timeout: 15, userAgent: "manifold" })
  return session
}

export class HttpError extends Error {}

/** GET `url` and return the body as text. Rejects on anything but 2xx. */
export function getText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const message = Soup.Message.new("GET", url)
    if (!message) {
      reject(new HttpError(`not a usable URL: ${url}`))
      return
    }

    shared().send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (self, result) => {
      try {
        const bytes = self?.send_and_read_finish(result)
        const status = message.get_status()

        if (status < 200 || status >= 300) {
          reject(new HttpError(`${url} answered ${status}`))
          return
        }

        const data = bytes?.get_data()
        if (!data) {
          reject(new HttpError(`${url} answered with an empty body`))
          return
        }

        resolve(new TextDecoder().decode(data))
      } catch (error) {
        reject(new HttpError(`${url}: ${error}`))
      }
    })
  })
}

/** GET `url` and parse the body as JSON. */
export async function getJson<T>(url: string): Promise<T> {
  return JSON.parse(await getText(url)) as T
}
