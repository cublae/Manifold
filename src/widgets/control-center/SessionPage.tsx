import { Gtk } from "ags/gtk4"
import { execAsync } from "ags/process"
import { _ } from "../../lib/i18n"

/**
 * Ending the session.
 *
 * Every entry is a command rather than a D-Bus call: logind and niri both have
 * command-line front ends that already do the right thing -- including the
 * inhibitor handling `systemctl suspend` performs and the confirmation niri
 * would otherwise pop up.
 *
 * Locking asks logind rather than starting a locker: `lock-session` is the
 * signal every screen locker listens for, so whichever one the user runs takes
 * it. On a session with no locker at all, nothing happens -- which is the
 * honest outcome, and better than this panel picking a locker for them.
 */

export interface SessionPageProps {
  /** Return to the main quick-settings page. */
  back: () => void
}

interface Action {
  icon: string
  label: string
  argv: string[]
}

const ACTIONS: Action[] = [
  { icon: "system-lock-screen-symbolic", label: _("Lock"), argv: ["loginctl", "lock-session"] },
  { icon: "system-log-out-symbolic", label: _("Log out"), argv: ["niri", "msg", "action", "quit", "--skip-confirmation"] },
  { icon: "weather-clear-night-symbolic", label: _("Suspend"), argv: ["systemctl", "suspend"] },
  { icon: "system-reboot-symbolic", label: _("Restart"), argv: ["systemctl", "reboot"] },
  { icon: "system-shutdown-symbolic", label: _("Power off"), argv: ["systemctl", "poweroff"] },
]

export default function SessionPage({ back }: SessionPageProps): Gtk.Widget {
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
        <label cssClasses={["title"]} hexpand halign={Gtk.Align.START} label={_("Session")} />
      </box>
    ) as Gtk.Widget,
  )

  const list = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 2,
    cssClasses: ["manifold-device-list"],
  })

  for (const action of ACTIONS) {
    list.append(
      (
        <button
          cssClasses={["manifold-device-row"]}
          onClicked={() => {
            back()
            execAsync(action.argv).catch((error) =>
              console.error(`manifold: ${action.argv[0]}: ${error}`),
            )
          }}
        >
          <box spacing={10}>
            <image iconName={action.icon} pixelSize={16} />
            <label hexpand halign={Gtk.Align.START} label={action.label} />
          </box>
        </button>
      ) as Gtk.Widget,
    )
  }

  page.append(list)
  return page
}
