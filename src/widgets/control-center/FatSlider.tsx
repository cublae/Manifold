import Gdk from "gi://Gdk?version=4.0"
import { Gtk } from "ags/gtk4"
import type { Accessor } from "ags"

/**
 * A slider drawn as a filled bar with the icon sitting inside it.
 *
 * GTK's scale is still doing the work -- the trough is simply tall enough to
 * hold an icon, and the handle is hidden, so the fill itself reads as the
 * control. The icon goes in an overlay rather than beside the scale so the bar
 * can span the full width the way the design calls for.
 *
 * Writing a value back usually makes the source notify, which would drive the
 * scale again and fight the user's drag. `syncing` breaks that loop.
 */

export interface FatSliderProps {
  icon: string | Accessor<string>
  value: Accessor<number>
  onChange: (value: number) => void
  tooltip?: string
}

export default function FatSlider({
  icon,
  value,
  onChange,
  tooltip,
}: FatSliderProps): Gtk.Widget {
  const scale = new Gtk.Scale({
    orientation: Gtk.Orientation.HORIZONTAL,
    adjustment: new Gtk.Adjustment({ lower: 0, upper: 1, stepIncrement: 0.05 }),
    drawValue: false,
    hexpand: true,
    cssClasses: ["manifold-fat-slider"],
  })

  let syncing = false

  const unsubscribe = value.subscribe(() => {
    syncing = true
    scale.set_value(value.get())
    syncing = false
  })
  scale.set_value(value.get())

  scale.connect("value-changed", () => {
    if (syncing) return
    onChange(scale.get_value())
  })
  scale.connect("destroy", () => unsubscribe())

  // GtkRange answers all four arrows by moving the value, which leaves a column
  // of sliders with no way out of it: pressing Down on the volume bar turns the
  // volume down instead of stepping to the microphone below. Up and Down move
  // focus here and Left and Right keep adjusting, which is the only reading of
  // the arrows that works in a panel laid out in rows.
  //
  // Capture phase, so this runs before the range's own handler rather than
  // after it has already changed the value.
  const keys = new Gtk.EventControllerKey()
  keys.set_propagation_phase(Gtk.PropagationPhase.CAPTURE)
  keys.connect("key-pressed", (_controller, keyval: number) => {
    let direction: Gtk.DirectionType
    if (keyval === Gdk.KEY_Up) direction = Gtk.DirectionType.UP
    else if (keyval === Gdk.KEY_Down) direction = Gtk.DirectionType.DOWN
    else return false

    // From the root, so the walk can leave the slider's own row.
    scale.get_root()?.child_focus(direction)
    return true
  })
  scale.add_controller(keys)

  const overlay = new Gtk.Overlay({ cssClasses: ["manifold-fat-slider-row"] })
  overlay.set_child(scale)

  const image = (
    <image
      iconName={icon}
      pixelSize={16}
      cssClasses={["manifold-fat-slider-icon"]}
      halign={Gtk.Align.START}
      valign={Gtk.Align.CENTER}
      // Never swallow the press: the whole bar has to stay draggable.
      canTarget={false}
    />
  ) as Gtk.Widget
  overlay.add_overlay(image)

  if (tooltip) overlay.set_tooltip_text(tooltip)
  return overlay
}
