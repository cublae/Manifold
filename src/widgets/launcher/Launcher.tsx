import Gdk from "gi://Gdk?version=4.0"
import GLib from "gi://GLib"
import { Astal, Gtk } from "ags/gtk4"
import app from "ags/gtk4/app"
import { execAsync } from "ags/process"
import type AstalAppsNS from "gi://AstalApps"
import { _ } from "../../lib/i18n"

import * as applications from "../../services/applications"
import * as pinned from "../../services/pinned"
import { copyText } from "../../services/clipboard"
import * as system from "../../services/system"
import { config } from "../../config"
import { calculate } from "../../lib/calculator"
import { searchEmoji, type Emoji } from "../../lib/emoji"
import { convert } from "../../lib/units"
import { appImage } from "../../lib/icons"
import { captureScope } from "../../lib/scope"
import { revealPanel } from "../common/revealPanel"
import { setWindowVisible } from "../common/popupVisibility"
import { WindowName } from "../names"

/**
 * Application launcher.
 *
 * Unlike the other dropdowns this needs the keyboard, so it is its own window
 * with `Keymode.EXCLUSIVE` -- the compositor routes every key to it while it is
 * open. That also means it must be closed carefully: leaving an exclusive
 * keyboard grab up would lock the user out of everything else.
 *
 * It is also the one panel that does not belong to the bar: it sits in the
 * middle of the screen, at a size that never changes, so the eye can go
 * straight back to where the first result was last time.
 *
 * Search comes from AstalApps' fuzzy matcher, which already weighs name,
 * keywords, categories and executable, and tracks launch frequency.
 *
 * A query that parses as arithmetic, or as a unit conversion, is answered as
 * well as searched: the result takes the top row, and Enter copies it rather
 * than launching anything. A query that starts with `>` is a command line
 * instead, run by a login shell on Enter.
 */

const ROW_ACTIVATED = "row-activated"

/** Panel size. Fixed on purpose: the list scrolls rather than the panel growing. */
const PANEL_WIDTH = 440
const LIST_HEIGHT = 420

/** Rows a page key moves by. Roughly a screenful at the row heights in use. */
const PAGE_ROWS = 7

/** Shown beside a calculated answer or a conversion. */
const CALCULATOR_ICON = "accessories-calculator-symbolic"

/** Shown beside a command the launcher offers to run. */
const TERMINAL_ICON = "utilities-terminal-symbolic"

/** Prefix that turns the query into a command line. */
const COMMAND_PREFIX = ">"

/** Prefix that searches emoji instead of applications. */
const EMOJI_PREFIX = ":"

/**
 * Emoji offered at once.
 *
 * The table has close to two thousand entries and every row is a widget, so a
 * bare `:` would spend a visible moment building a list nobody scrolls to the
 * end of. Anyone looking past the first two hundred is better served by typing
 * another word.
 */
const EMOJI_LIMIT = 200

/** An answer worth putting above the applications: a sum or a conversion. */
interface Answer {
  kind: "answer"
  value: string
}

/** A command line the user typed, ready to run. */
interface Command {
  kind: "command"
  line: string
}

/** A character the user can take from the emoji table. */
interface EmojiResult {
  kind: "emoji"
  emoji: Emoji
}

/** A row in the list: an application, something to copy, or a command to run. */
type Result =
  | { kind: "app"; app: AstalAppsNS.Application }
  | Answer
  | Command
  | EmojiResult

export default function Launcher(): Astal.Window {
  const inScope = captureScope()

  const entry = new Gtk.Entry({
    placeholderText: _("Search applications…"),
    cssClasses: ["manifold-launcher-entry"],
    hexpand: true,
    primaryIconName: "system-search-symbolic",
  })

  const list = new Gtk.ListBox({
    selectionMode: Gtk.SelectionMode.BROWSE,
    cssClasses: ["manifold-launcher-list"],
  })

  const empty = new Gtk.Label({
    label: _("No matches"),
    cssClasses: ["manifold-launcher-empty", "dim"],
    visible: false,
    vexpand: true,
  })

  // No `propagateNaturalHeight` here: the viewport takes the fixed height it is
  // given and scrolls, instead of the panel resizing itself around the results.
  const scroller = new Gtk.ScrolledWindow({
    hscrollbarPolicy: Gtk.PolicyType.NEVER,
    vscrollbarPolicy: Gtk.PolicyType.AUTOMATIC,
    vexpand: true,
    child: list,
  })

  const body = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    heightRequest: LIST_HEIGHT,
  })
  body.append(empty)
  body.append(scroller)

  const content = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 10,
    cssClasses: ["manifold-popup-content", "manifold-launcher"],
    widthRequest: PANEL_WIDTH,
  })
  content.append(entry)
  content.append(body)

  const panel = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    cssClasses: [
      "manifold-panel",
      "manifold-root",
      "manifold-popup",
      // No position class: this one is not flush with any edge, so it keeps
      // all four corners and its margin all the way round.
      "manifold-popup-floating",
    ],
  })
  panel.append(content)

  const root = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    hexpand: true,
    vexpand: true,
  })
  const window = (
    <window
      name={WindowName.Launcher}
      namespace="manifold-launcher"
      cssClasses={["manifold-window", "manifold-launcher-window"]}
      application={app}
      anchor={
        Astal.WindowAnchor.TOP |
        Astal.WindowAnchor.BOTTOM |
        Astal.WindowAnchor.LEFT |
        Astal.WindowAnchor.RIGHT
      }
      // Ignores the bar.s exclusive zone: the surface covers the whole output,
      // so the panel lands in the middle of the screen rather than in the
      // middle of what is left below the bar.
      exclusivity={Astal.Exclusivity.IGNORE}
      layer={Astal.Layer.TOP}
      // Takes the keyboard for as long as it is open, so typing goes here and
      // not to whatever was focused underneath.
      keymode={Astal.Keymode.EXCLUSIVE}
      visible={false}
    >
      {root}
    </window>
  ) as Astal.Window

  // Filled in after the window exists: the revealer takes over its visibility.
  root.append(revealPanel({ window, panel, centered: true }))

  // AstalApps is kept for its scoring; the list itself comes from the index in
  // services/applications, which reads the desktop directories itself.
  let scorer: AstalAppsNS.Apps | null = null
  let installed: AstalAppsNS.Application[] = []
  let results: Result[] = []

  function close(): void {
    setWindowVisible(window, false)
    entry.set_text("")
  }

  /** Act on a row: run the application or the command, or take the answer. */
  function activate(result: Result | undefined): void {
    if (!result) return
    close()

    if (result.kind === "app") {
      // Bumps the frequency counter AstalApps uses to rank future searches.
      result.app.launch()
      return
    }

    if (result.kind === "command") {
      // Through a *login* shell. A shell is wanted because the point of typing
      // a command line is the pipes, the redirections and the `&&` only a shell
      // understands; a login one because the shell inherits Manifold's own
      // environment, whose PATH is the wrapper's and holds none of the user's
      // programs.
      execAsync(["sh", "-lc", result.line]).catch((error) =>
        console.error(`manifold: ${result.line}: ${error}`),
      )
      return
    }

    // Both of the remaining kinds end up on the clipboard: there is nothing
    // else to do with a sum or a character.
    const text = result.kind === "emoji" ? result.emoji.char : result.value

    void copyText(text).catch((error) =>
      console.error(`manifold: could not copy the result: ${error}`),
    )
  }

  function appRow(app: AstalAppsNS.Application): Gtk.Widget {
    const box = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 12 })
    box.append(appImage(app.iconName, 32, "application-x-executable"))

    const text = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, valign: Gtk.Align.CENTER, hexpand: true })
    text.append(new Gtk.Label({ label: app.name, halign: Gtk.Align.START, cssClasses: ["name"] }))

    if (app.description) {
      text.append(
        new Gtk.Label({
          label: app.description,
          halign: Gtk.Align.START,
          ellipsize: 3,
          maxWidthChars: 44,
          cssClasses: ["description", "dim"],
        }),
      )
    }
    box.append(text)

    // The pin lives on the row rather than in a context menu: a menu inside a
    // surface that holds an exclusive keyboard grab is a second thing to get
    // right, and a button that fades in under the pointer says what it does.
    // It keeps its space whether or not it is drawn, so rows do not shuffle
    // sideways as the pointer crosses them.
    const on = pinned.isPinned(app.entry)
    const pin = new Gtk.Button({
      cssClasses: on
        ? ["manifold-launcher-pin", "flat", "pinned"]
        : ["manifold-launcher-pin", "flat"],
      iconName: on ? "starred-symbolic" : "non-starred-symbolic",
      tooltipText: on ? "Unpin" : "Pin to the top",
      valign: Gtk.Align.CENTER,
      // Otherwise the row's own activation fires as well and the launcher
      // closes on the way to pinning something.
      canFocus: false,
    })
    pin.connect("clicked", () => togglePin(app))
    box.append(pin)

    const listRow = new Gtk.ListBoxRow({ cssClasses: ["manifold-launcher-row"], child: box })
    return listRow
  }

  /** The answer to a sum, offered above the applications. */
  function answerRow(answer: Answer): Gtk.Widget {
    const box = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 12 })
    box.append(new Gtk.Image({ iconName: CALCULATOR_ICON, pixelSize: 32 }))

    const text = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, valign: Gtk.Align.CENTER, hexpand: true })
    text.append(
      new Gtk.Label({
        label: `= ${answer.value}`,
        halign: Gtk.Align.START,
        cssClasses: ["name"],
      }),
    )
    text.append(
      new Gtk.Label({
        label: _("Press Enter to copy"),
        halign: Gtk.Align.START,
        cssClasses: ["description", "dim"],
      }),
    )
    box.append(text)

    return new Gtk.ListBoxRow({ cssClasses: ["manifold-launcher-row"], child: box })
  }

  /** A command line, offered as the one thing worth doing with that query. */
  function commandRow(command: Command): Gtk.Widget {
    const box = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 12 })
    box.append(new Gtk.Image({ iconName: TERMINAL_ICON, pixelSize: 32 }))

    const text = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      valign: Gtk.Align.CENTER,
      hexpand: true,
    })
    text.append(
      new Gtk.Label({
        label: command.line,
        halign: Gtk.Align.START,
        ellipsize: 3,
        maxWidthChars: 44,
        cssClasses: ["name"],
      }),
    )
    text.append(
      new Gtk.Label({
        label: _("Run command"),
        halign: Gtk.Align.START,
        cssClasses: ["description", "dim"],
      }),
    )
    box.append(text)

    return new Gtk.ListBoxRow({ cssClasses: ["manifold-launcher-row"], child: box })
  }

  /** One character from the emoji table, drawn at the size of an app icon. */
  function emojiRow({ emoji }: EmojiResult): Gtk.Widget {
    const box = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 12 })
    box.append(
      new Gtk.Label({
        label: emoji.char,
        cssClasses: ["manifold-launcher-emoji"],
        // The same width every icon gets, so the names line up with the rows
        // above and below whatever the character's own advance is.
        widthRequest: 32,
      }),
    )

    const text = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      valign: Gtk.Align.CENTER,
      hexpand: true,
    })
    text.append(new Gtk.Label({ label: emoji.name, halign: Gtk.Align.START, cssClasses: ["name"] }))
    text.append(
      new Gtk.Label({
        label: emoji.group,
        halign: Gtk.Align.START,
        cssClasses: ["description", "dim"],
      }),
    )
    box.append(text)

    return new Gtk.ListBoxRow({ cssClasses: ["manifold-launcher-row"], child: box })
  }

  function row(result: Result): Gtk.Widget {
    if (result.kind === "app") return appRow(result.app)
    if (result.kind === "command") return commandRow(result)
    if (result.kind === "emoji") return emojiRow(result)
    return answerRow(result)
  }
  /**
   * Bring a row into view.
   *
   * The selection is moved from the entry, which keeps the keyboard focus, so
   * nothing scrolls on its own -- GTK only follows focus, and focus never
   * leaves the search field.
   */
  function scrollTo(listRow: Gtk.ListBoxRow): void {
    const adjustment = scroller.get_vadjustment()
    const [ok, bounds] = listRow.compute_bounds(list)
    if (!ok) return

    const top = bounds.origin.y
    const bottom = top + bounds.size.height
    const view = adjustment.get_value()
    const page = adjustment.get_page_size()

    if (top < view) adjustment.set_value(top)
    else if (bottom > view + page) adjustment.set_value(bottom - page)
  }

  /** Move the selection by `step` rows, clamped to the list, and follow it. */
  function move(step: number): boolean {
    const last = results.length - 1
    if (last < 0) return true

    const index = list.get_selected_row()?.get_index() ?? 0
    const next = list.get_row_at_index(Math.min(last, Math.max(0, index + step)))
    if (!next) return true

    list.select_row(next)
    scrollTo(next)
    return true
  }

  /**
   * Pin or unpin an application and stay with it.
   *
   * Pinning reorders the list under the user, so the row is found again and
   * re-selected afterwards -- otherwise the highlight snaps back to the top and
   * the next Enter launches whatever happens to be there. A turn later, because
   * the rows have only just been added and have no allocation to scroll to yet.
   */
  function togglePin(app: AstalAppsNS.Application): void {
    pinned.togglePin(app.entry)
    search(entry.get_text())

    const index = results.findIndex((result) => result.kind === "app" && result.app === app)
    if (index < 0) return

    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      const listRow = list.get_row_at_index(index)
      if (listRow) {
        list.select_row(listRow)
        scrollTo(listRow)
      }
      return GLib.SOURCE_REMOVE
    })
  }

  function search(query: string): void {
    const term = query.trim()

    // A command line is a mode of its own: the prefix says the user is not
    // looking for an application, so nothing else is offered.
    if (term.startsWith(COMMAND_PREFIX)) {
      const line = term.slice(COMMAND_PREFIX.length).trim()
      fill(line ? [{ kind: "command", line }] : [])
      return
    }

    // So is the emoji table. A bare `:` opens it in Unicode's own order, which
    // is the order every emoji picker shows: smileys first, flags last.
    if (term.startsWith(EMOJI_PREFIX)) {
      const found = searchEmoji(term.slice(EMOJI_PREFIX.length).trim(), EMOJI_LIMIT)
      fill(found.map((emoji): Result => ({ kind: "emoji", emoji })))
      return
    }

    // Ranking stays with AstalApps -- `fuzzy_score` applies the same weights
    // and include settings its own query would -- but the list it ranks is the
    // one read from disk, so a program installed a minute ago is in it.
    const apps: Result[] = []

    if (term && scorer) {
      const scored: Array<[AstalAppsNS.Application, number]> = []
      for (const app of installed) {
        const score = scorer.fuzzy_score(term, app)
        if (score >= scorer.minScore) scored.push([app, score])
      }
      scored.sort((a, b) => b[1] - a[1])
      apps.push(...scored.map(([app]): Result => ({ kind: "app", app })))
    } else {
      // An empty query lists the whole menu: pinned first, in the order they
      // were pinned, then everything else most-launched first. Searching is
      // deliberately left alone -- someone who typed a name wants the closest
      // match to that name, not their pins pushed in front of it.
      const ids = pinned.pinnedIds()
      const byId = new Map(installed.map((app) => [app.entry, app]))

      const top = ids
        .map((id) => byId.get(id))
        .filter((app): app is AstalAppsNS.Application => app !== undefined)

      apps.push(...top.map((app): Result => ({ kind: "app", app })))
      apps.push(
        ...installed
          .filter((app) => !pinned.isPinned(app.entry))
          .map((app): Result => ({ kind: "app", app })),
      )
    }

    // A sum or a conversion takes the top row: someone who typed one is waiting
    // for the answer, not for an application whose name scores against "12*8".
    const value = calculate(term) ?? convert(term)
    fill(value === null ? apps : [{ kind: "answer", value }, ...apps])
  }

  /** Put a set of results on screen, selection and scroll reset. */
  function fill(rows: Result[]): void {
    results = rows

    let child = list.get_first_child()
    while (child) {
      const next = child.get_next_sibling()
      list.remove(child)
      child = next
    }
    for (const result of results) list.append(inScope(() => row(result)))

    empty.set_visible(results.length === 0)
    scroller.set_visible(results.length > 0)

    // A new set of results always reads from the top.
    scroller.get_vadjustment().set_value(0)

    const first = list.get_row_at_index(0)
    if (first) list.select_row(first)
  }

  entry.connect("changed", () => search(entry.get_text()))
  entry.connect("activate", () => activate(results[list.get_selected_row()?.get_index() ?? 0]))
  list.connect(ROW_ACTIVATED, (_list, selected: Gtk.ListBoxRow) => activate(results[selected.get_index()]))

  // -- keyboard ------------------------------------------------------------
  const keys = new Gtk.EventControllerKey()
  keys.connect("key-pressed", (_controller, keyval: number, _code: number, state: Gdk.ModifierType) => {
    if (keyval === Gdk.KEY_Escape) {
      close()
      return true
    }

    // Ctrl+P pins the highlighted application, so the list can be arranged
    // without reaching for the mouse.
    if ((keyval === Gdk.KEY_p || keyval === Gdk.KEY_P) && state & Gdk.ModifierType.CONTROL_MASK) {
      const selected = results[list.get_selected_row()?.get_index() ?? 0]
      if (selected?.kind === "app") togglePin(selected.app)
      return true
    }

    // Arrow and page keys move the selection while the entry keeps focus, so
    // the user never has to tab out of the search field. Home and End are
    // deliberately left alone: the entry claims them first to move the text
    // cursor, which is what they should do in a search field.
    if (keyval === Gdk.KEY_Down) return move(1)
    if (keyval === Gdk.KEY_Up) return move(-1)
    if (keyval === Gdk.KEY_Page_Down) return move(PAGE_ROWS)
    if (keyval === Gdk.KEY_Page_Up) return move(-PAGE_ROWS)

    return false
  })
  window.add_controller(keys)

  // Dismiss on click outside the panel.
  const click = new Gtk.GestureClick({ button: 0 })
  click.connect("pressed", (_gesture, _n: number, x: number, y: number) => {
    const [ok, bounds] = panel.compute_bounds(root)
    if (!ok) return
    const inside =
      x >= bounds.origin.x &&
      x <= bounds.origin.x + bounds.size.width &&
      y >= bounds.origin.y &&
      y <= bounds.origin.y + bounds.size.height
    if (!inside) close()
  })
  root.add_controller(click)

  // Focus the entry every time the launcher opens, and reset the query.
  window.connect("notify::visible", () => {
    if (!window.visible) return
    entry.set_text("")
    search("")
    entry.grab_focus()

    // Anything installed since the last time the launcher was open belongs in
    // this list. The results stay on screen while the directories are re-read
    // and are redrawn when the new list lands.
    void applications.refreshApplications()
  })

  void (async () => {
    scorer = await system.apps()
    if (!scorer) return

    const { minScore, showHidden } = config.get().launcher
    scorer.minScore = minScore
    scorer.showHidden = showHidden

    const refresh = async () => {
      installed = await applications.applications()
      search(entry.get_text())
    }

    await refresh()

    // Keeps a launcher that is already open in step with an install finishing.
    applications.onApplicationsChanged(() => void refresh())
  })()

  return window
}
