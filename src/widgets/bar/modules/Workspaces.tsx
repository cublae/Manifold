import { Gtk } from "ags/gtk4"
import { For, createBinding, createComputed } from "ags"

import Niri from "../../../services/niri"
import type { Window, Workspace } from "../../../services/niri.types"
import { config } from "../../../config"
import { appIcons, loadAppIcons, resolveAppIcon } from "../../../lib/appIcons"
import { isVertical, moduleOrientation } from "../../../lib/barLayout"
import type { BarPosition } from "../../../config"

export interface WorkspacesProps {
  /** Connector name of the monitor this bar sits on, e.g. "eDP-1". */
  output: string | null
  /** Where the bar sits, which decides how each button stacks. */
  position: BarPosition
}

interface Item {
  id: number
  text: string
  tooltip: string
  classes: string[]
  /** Icon names for the windows on this workspace, in niri's own order. */
  icons: string[]
}

function label(workspace: Workspace, style: "index" | "name" | "none"): string {
  if (style === "none") return ""
  if (style === "name") return workspace.name ?? String(workspace.idx)
  return String(workspace.idx)
}

function classesFor(workspace: Workspace, isEmpty: boolean): string[] {
  const classes = ["manifold-ws-dot"]
  // niri distinguishes "active on its output" from "active and focused"; the
  // difference is visible on multi-monitor setups, so both get a class.
  if (workspace.is_active) classes.push("active")
  if (workspace.is_focused) classes.push("focused")
  if (workspace.is_urgent) classes.push("urgent")
  if (isEmpty) classes.push("empty")
  return classes
}

/** Tooltip listing what is actually on the workspace. */
function tooltipFor(workspace: Workspace, windows: Window[]): string {
  const name = workspace.name ?? `Workspace ${workspace.idx}`
  if (windows.length === 0) return name

  const titles = windows
    .map((w) => w.title || w.app_id || "Untitled")
    .slice(0, 6)
    .map((title) => (title.length > 44 ? `${title.slice(0, 43)}…` : title))

  const more = windows.length > titles.length ? `\n…and ${windows.length - titles.length} more` : ""
  return `${name}\n${titles.join("\n")}${more}`
}

/**
 * The contents of one workspace button.
 *
 * Built imperatively: the children are a plain, already-known list, and going
 * through JSX for a mixed label-plus-icons row would need a Fragment for no
 * gain.
 */
function content(item: Item, position: BarPosition): Gtk.Widget {
  // In a vertical bar the number sits above its icons instead of beside them,
  // which is the only way both fit in a bar a few dozen pixels wide.
  const box = new Gtk.Box({
    orientation: moduleOrientation(position),
    spacing: 3,
    halign: Gtk.Align.CENTER,
  })

  if (item.text) {
    box.append(new Gtk.Label({ label: item.text, cssClasses: ["index"] }))
  }

  for (const icon of item.icons) {
    box.append(new Gtk.Image({ iconName: icon, pixelSize: 14, cssClasses: ["app"] }))
  }

  return box
}

/**
 * Workspace indicator.
 *
 * niri creates and destroys workspaces dynamically, so the buttons follow a
 * `<For>` over derived state. `For` hands the render function a plain value and
 * decides what to re-render by comparing keys, so the key has to cover
 * everything the button draws -- keying on the workspace id alone would leave
 * both the highlight and the icon row stale. Encoding the appearance in the key
 * rebuilds exactly the buttons that changed and leaves the rest untouched.
 */
export default function Workspaces({ output, position }: WorkspacesProps): Gtk.Widget {
  const niri = Niri.get_default()

  // The icon index is shared and reactive; the first call starts it loading.
  loadAppIcons()

  const items = createComputed(
    [
      createBinding(niri, "workspaces"),
      createBinding(niri, "windows"),
      config,
      appIcons,
    ],
    (workspaces, windows, cfg, icons): Item[] => {
      const scope =
        cfg.workspaces.perMonitor && output
          ? workspaces.filter((w) => w.output === output)
          : workspaces

      const byWorkspace = new Map<number, Window[]>()
      for (const window of windows) {
        if (window.workspace_id === null) continue
        const list = byWorkspace.get(window.workspace_id)
        if (list) list.push(window)
        else byWorkspace.set(window.workspace_id, [window])
      }

      return scope
        .filter(
          (w) => cfg.workspaces.showEmpty || byWorkspace.has(w.id) || w.is_active,
        )
        .map((workspace) => {
          const own = byWorkspace.get(workspace.id) ?? []

          return {
            id: workspace.id,
            text: label(workspace, cfg.workspaces.labels),
            tooltip: tooltipFor(workspace, own),
            classes: classesFor(workspace, own.length === 0),
            icons: cfg.workspaces.showIcons
              ? own
                  .slice(0, Math.max(0, cfg.workspaces.maxIcons))
                  .map((w) => resolveAppIcon(icons, w.app_id))
              : [],
          }
        })
    },
  )

  /** Move focus one workspace along, within this bar's output. */
  function cycle(direction: 1 | -1): void {
    const list = niri.workspacesOn(config.get().workspaces.perMonitor ? output : null)
    if (list.length === 0) return

    const current = list.findIndex((w) => w.is_active)
    if (current === -1) return

    const next = list[current + direction]
    if (next) void niri.focusWorkspaceId(next.id)
  }

  return (
    <box
      cssClasses={["manifold-module", "manifold-workspaces"]}
      orientation={moduleOrientation(position)}
      $={(self: Gtk.Widget) => {
        // GTK4 routes input through event controllers rather than widget
        // signals, so scroll-to-switch has to be attached explicitly.
        const scroll = new Gtk.EventControllerScroll({
          flags: Gtk.EventControllerScrollFlags.BOTH_AXES,
        })
        scroll.connect("scroll", (_source, dx: number, dy: number) => {
          const delta = dy !== 0 ? dy : dx
          if (delta === 0) return false
          cycle(delta > 0 ? 1 : -1)
          return true
        })
        self.add_controller(scroll)
      }}
    >
      <For
        each={items}
        id={(item: Item) =>
          `${item.id}:${item.classes.join(".")}:${item.text}:${item.icons.join(",")}`
        }
      >
        {(item: Item) => (
          <button
            cssClasses={item.classes}
            tooltipText={item.tooltip}
            onClicked={() => void niri.focusWorkspaceId(item.id)}
          >
            {content(item, position)}
          </button>
        )}
      </For>
    </box>
  ) as Gtk.Widget
}
