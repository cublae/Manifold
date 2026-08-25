import GLib from "gi://GLib"
import { Gtk } from "ags/gtk4"
import { _ } from "../../lib/i18n"

import { config } from "../../config"

/**
 * A month grid, drawn by hand rather than with `Gtk.Calendar`.
 *
 * The stock widget bakes in its own header -- month and year steppers side by
 * side -- and gives no handle on individual days, so marking weekends or the
 * current date is out of reach. Everything here is plain labels in a grid: the
 * cells are built once and only their text and style classes change as the user
 * pages through months, which keeps navigation allocation-free.
 */

const COLUMNS = 7
/** Six rows cover any month, whichever weekday it starts on. */
const ROWS = 6

/** Weekday numbers follow `GLib.DateTime`: Monday is 1, Sunday is 7. */
const MONDAY = 1
const SUNDAY = 7
const SATURDAY = 6

function firstWeekday(): number {
  return config.get().calendar.firstDay === "sunday" ? SUNDAY : MONDAY
}

function isWeekend(day: number): boolean {
  return day === SATURDAY || day === SUNDAY
}

/**
 * A date at noon.
 *
 * Noon, not midnight: a DST jump can land a midnight timestamp on the previous
 * day, which would shift the whole grid by one. The bindings mark these calls
 * nullable because they reject dates that do not exist, so the casts live here
 * rather than at every call site.
 */
function noon(year: number, month: number, day: number): GLib.DateTime {
  return GLib.DateTime.new_local(year, month, day, 12, 0, 0) as GLib.DateTime
}

function shiftDays(from: GLib.DateTime, days: number): GLib.DateTime {
  return from.add_days(days) as GLib.DateTime
}

function shiftMonths(from: GLib.DateTime, months: number): GLib.DateTime {
  return from.add_months(months) as GLib.DateTime
}

function isSameDay(a: GLib.DateTime, b: GLib.DateTime): boolean {
  return (
    a.get_year() === b.get_year() &&
    a.get_month() === b.get_month() &&
    a.get_day_of_month() === b.get_day_of_month()
  )
}

/**
 * Localised month heading.
 *
 * `%OB` is the *standalone* month name, which a good few languages spell
 * differently from the genitive `%B` that belongs inside a full date.
 */
function heading(time: GLib.DateTime): string {
  return time.format("%OB %Y") ?? time.format("%B %Y") ?? ""
}

/**
 * One-letter column headers in the user's locale.
 *
 * Built from a known Monday rather than from a hard-coded table so the names
 * come out of the C library along with everything else.
 */
function weekdayInitial(offset: number): string {
  const monday = noon(2024, 1, 1)
  const name = shiftDays(monday, offset).format("%a") ?? ""
  return [...name].slice(0, 1).join("").toUpperCase()
}

export default function Calendar(): Gtk.Widget {
  const now = GLib.DateTime.new_now_local()
  let viewYear = now.get_year()
  let viewMonth = now.get_month()

  // -- header --------------------------------------------------------------
  const title = new Gtk.Label({ cssClasses: ["title"] })

  const stepper = (icon: string, months: number, tooltip: string): Gtk.Widget => {
    const button = new Gtk.Button({
      cssClasses: ["manifold-calendar-nav", "flat"],
      iconName: icon,
      tooltipText: tooltip,
      valign: Gtk.Align.CENTER,
    })
    button.connect("clicked", () => step(months))
    return button
  }

  // Pressing the heading jumps back to the month the user is actually in --
  // otherwise paging six months out leaves no quick way home.
  const home = new Gtk.Button({
    cssClasses: ["manifold-calendar-title", "flat"],
    hexpand: true,
    child: title,
    tooltipText: _("Back to today"),
  })
  home.connect("clicked", () => {
    const today = GLib.DateTime.new_now_local()
    viewYear = today.get_year()
    viewMonth = today.get_month()
    render()
  })

  const header = new Gtk.Box({
    orientation: Gtk.Orientation.HORIZONTAL,
    cssClasses: ["manifold-calendar-header"],
  })
  header.append(stepper("pan-start-symbolic", -1, "Previous month"))
  header.append(home)
  header.append(stepper("pan-end-symbolic", 1, "Next month"))

  // -- grid ----------------------------------------------------------------
  const grid = new Gtk.Grid({
    cssClasses: ["manifold-calendar-grid"],
    columnHomogeneous: true,
    rowSpacing: 2,
    columnSpacing: 2,
  })

  const weekdays: Gtk.Label[] = []
  for (let column = 0; column < COLUMNS; column++) {
    const label = new Gtk.Label({ cssClasses: ["weekday"] })
    weekdays.push(label)
    grid.attach(label, column, 0, 1, 1)
  }

  const cells: Gtk.Label[] = []
  for (let index = 0; index < ROWS * COLUMNS; index++) {
    const label = new Gtk.Label({ cssClasses: ["day"] })
    cells.push(label)
    grid.attach(label, index % COLUMNS, 1 + Math.floor(index / COLUMNS), 1, 1)
  }

  // -- painting ------------------------------------------------------------
  function render(): void {
    const today = GLib.DateTime.new_now_local()
    const start = firstWeekday()

    const first = noon(viewYear, viewMonth, 1)
    title.set_label(heading(first))

    for (let column = 0; column < COLUMNS; column++) {
      const offset = (start - MONDAY + column) % COLUMNS
      weekdays[column].set_label(weekdayInitial(offset))
      weekdays[column].set_css_classes(
        isWeekend(offset + MONDAY) ? ["weekday", "weekend"] : ["weekday"],
      )
    }

    // Back up to the first cell of the week the 1st falls in, so the grid can
    // run straight through and spill into the neighbouring months.
    const lead = (first.get_day_of_week() - start + COLUMNS) % COLUMNS
    const origin = shiftDays(first, -lead)

    for (let index = 0; index < cells.length; index++) {
      const date = shiftDays(origin, index)
      const classes = ["day"]

      if (date.get_month() !== viewMonth) classes.push("other-month")
      if (isWeekend(date.get_day_of_week())) classes.push("weekend")
      if (isSameDay(date, today)) classes.push("today")

      cells[index].set_label(String(date.get_day_of_month()))
      cells[index].set_css_classes(classes)
    }
  }

  function step(months: number): void {
    const next = shiftMonths(noon(viewYear, viewMonth, 1), months)
    viewYear = next.get_year()
    viewMonth = next.get_month()
    render()
  }

  const root = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 4,
    cssClasses: ["manifold-calendar"],
  })
  root.append(header)
  root.append(grid)

  render()

  // The panel is a dropdown, so it is mapped afresh every time it is opened:
  // repainting here is what keeps the highlight on the right day after the
  // date has rolled over, without a timer running all session.
  root.connect("map", () => render())

  return root
}
