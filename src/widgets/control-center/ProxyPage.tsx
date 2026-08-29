import { Gtk } from "ags/gtk4"
import { For, createComputed, createState } from "ags"
import { _ } from "../../lib/i18n"

import * as mihomo from "../../services/mihomo"
import { captureScope } from "../../lib/scope"

/**
 * Node picker for the mihomo core.
 *
 * The core's own front-end owns subscriptions, routing and the log; what is
 * here is what you would otherwise open an application to do: change how
 * traffic is routed, move to a different node, and find out which nodes are
 * still fast.
 *
 * Groups that choose their own node -- URLTest and the like -- are listed
 * without their nodes. Selecting inside one is not refused by the core so much
 * as immediately undone by it, and a list that snaps back is worse than no
 * list.
 */

export interface ProxyPageProps {
  /** Return to the main quick-settings page. */
  back: () => void
}

const MODES: Array<{ mode: mihomo.Mode; label: string; hint: string }> = [
  { mode: "rule", label: _("Rules"), hint: _("Route by the core's rule list") },
  { mode: "global", label: _("Global"), hint: _("Everything through the proxy") },
  { mode: "direct", label: _("Direct"), hint: _("Everything past the proxy") },
]

/** Milliseconds, coloured the way a latency reading is usually read. */
function delayClass(delay: number): string {
  if (delay < 200) return "good"
  if (delay < 500) return "fair"
  return "poor"
}

function ModeRow(): Gtk.Widget {
  const row = new Gtk.Box({ spacing: 4, cssClasses: ["manifold-proxy-modes"], homogeneous: true })

  for (const { mode, label, hint } of MODES) {
    const active = mihomo.state.as((s) => s.mode === mode)

    row.append(
      (
        <button
          cssClasses={active.as((on) => ["manifold-module", ...(on ? ["active"] : [])])}
          tooltipText={hint}
          onClicked={() => void mihomo.setMode(mode)}
        >
          <label label={label} />
        </button>
      ) as Gtk.Widget,
    )
  }

  return row
}

function NodeRow(group: string, node: mihomo.Node, current: boolean): Gtk.Widget {
  const button = new Gtk.Button({
    cssClasses: ["manifold-proxy-node", ...(current ? ["active"] : [])],
  })

  const body = (
    <box spacing={8}>
      <image
        iconName={current ? "object-select-symbolic" : "network-vpn-symbolic"}
        cssClasses={current ? [] : ["dim"]}
      />
      <label hexpand halign={Gtk.Align.START} ellipsize={3} label={node.name} />
      {node.delay === null ? (
        <label cssClasses={["dim"]} label="—" />
      ) : (
        <label cssClasses={["delay", delayClass(node.delay)]} label={`${node.delay} ms`} />
      )}
    </box>
  ) as Gtk.Widget

  button.set_child(body)
  button.connect("clicked", () => void mihomo.select(group, node.name))
  return button
}

/**
 * One group: its current node, and the list to change it.
 *
 * The list is collapsed to begin with. A subscription is dozens of nodes, and
 * three groups expanded at once would bury the mode buttons above them.
 */
function GroupSection(group: mihomo.Group): Gtk.Widget {
  const inScope = captureScope()
  const [open, setOpen] = createState(false)
  const [testing, setTesting] = createState(false)

  const section = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 4 })

  const header = (
    <box spacing={6}>
      <button
        cssClasses={["manifold-module", "manifold-proxy-group"]}
        hexpand
        onClicked={() => setOpen(!open.get())}
      >
        <box spacing={8}>
          <label cssClasses={["title"]} label={group.name} />
          <label
            cssClasses={["subtitle"]}
            hexpand
            halign={Gtk.Align.END}
            ellipsize={3}
            label={group.now || _("None")}
          />
          <image
            iconName={open.as((on) => (on ? "go-up-symbolic" : "go-down-symbolic"))}
            cssClasses={["dim"]}
          />
        </box>
      </button>
      <button
        cssClasses={["manifold-module"]}
        tooltipText={_("Test latency")}
        sensitive={testing.as((on) => !on)}
        onClicked={() => {
          setTesting(true)
          void mihomo
            .testGroup(group.name)
            .catch((error) => console.error(`manifold: latency test failed: ${error}`))
            .finally(() => setTesting(false))
        }}
      >
        <image
          iconName={testing.as((on) =>
            on ? "content-loading-symbolic" : "preferences-system-time-symbolic",
          )}
        />
      </button>
    </box>
  ) as Gtk.Widget

  section.append(header)

  // Only selector groups get a list; the rest have nothing to choose from.
  if (group.selectable) {
    const nodes = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 2 })
    for (const node of group.nodes) {
      nodes.append(inScope(() => NodeRow(group.name, node, node.name === group.now)))
    }

    const revealer = new Gtk.Revealer({
      transitionType: Gtk.RevealerTransitionType.SLIDE_DOWN,
      child: nodes,
    })
    open.subscribe(() => revealer.set_reveal_child(open.get()))
    section.append(revealer)
  }

  return section
}

export default function ProxyPage({ back }: ProxyPageProps): Gtk.Widget {
  const inScope = captureScope()

  const list = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 10 })

  const scroller = new Gtk.ScrolledWindow({
    hscrollbarPolicy: Gtk.PolicyType.NEVER,
    vscrollbarPolicy: Gtk.PolicyType.AUTOMATIC,
    vexpand: true,
    child: list,
  })

  const page = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 10,
    cssClasses: ["manifold-cc-page"],
  })

  page.append(
    (
      <box cssClasses={["manifold-cc-header"]} spacing={6}>
        <button cssClasses={["manifold-module"]} tooltipText={_("Back")} onClicked={back}>
          <image iconName="go-previous-symbolic" />
        </button>
        <label cssClasses={["title"]} hexpand halign={Gtk.Align.START} label={_("Proxy")} />
        <label
          cssClasses={["dim"]}
          label={mihomo.state.as((s) => (s.running ? s.version : ""))}
        />
      </box>
    ) as Gtk.Widget,
  )

  page.append(inScope(() => ModeRow()))
  page.append(scroller)

  // Rebuilt on every poll rather than bound row by row: a group's node list is
  // static between subscription updates, and the one thing that does change
  // often -- the latency readings -- changes for the whole list at once.
  const groups = mihomo.state.as((s) => s.groups)
  const rebuild = () => {
    let child = list.get_first_child()
    while (child) {
      const next = child.get_next_sibling()
      list.remove(child)
      child = next
    }

    const current = groups.get()
    if (current.length === 0) {
      list.append(
        inScope(() => (<label cssClasses={["dim"]} label={_("The core is not running")} />) as Gtk.Widget),
      )
      return
    }

    for (const group of current) list.append(inScope(() => GroupSection(group)))
  }

  rebuild()
  groups.subscribe(rebuild)

  return page
}
