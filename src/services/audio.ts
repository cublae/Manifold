import * as system from "./system"
import { config } from "../config"
import { clamp } from "../lib/utils"

/**
 * Volume ceiling for the default output.
 *
 * Neither PipeWire nor `wpctl` stops at 100%: a volume-up key held down runs
 * on to 150%, which is software gain and sounds like it. The shell has no say
 * in what sets the volume -- media keys go straight to WirePlumber -- so the
 * limit is enforced after the fact, by watching the endpoint and pulling it
 * back down.
 *
 * Writing the volume notifies again, so the guard has to be an inequality: the
 * corrective write lands exactly on the limit and the next notification finds
 * nothing to do.
 */

/** Absolute ceiling, whatever the config says. Above this it is only distortion. */
const HARD_MAX = 1.5

/**
 * Volumes come back as doubles that rarely land on a round number, so a value
 * a hair over the limit is treated as being at it rather than corrected in a
 * loop of ever smaller steps.
 */
const EPSILON = 0.0005

export default function enforceVolumeLimit(): void {
  void (async () => {
    const speaker = await system.speaker()
    if (!speaker) return

    const apply = () => {
      const limit = clamp(config.get().audio.maxVolume, 0, HARD_MAX)
      if (speaker.volume > limit + EPSILON) speaker.volume = limit
    }

    speaker.connect("notify::volume", apply)
    apply()
  })()
}
