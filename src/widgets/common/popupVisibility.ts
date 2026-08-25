import type { Astal } from "ags/gtk4"

/**
 * Show and hide windows that animate on their way in and out.
 *
 * A window that plays a closing animation is still mapped while it plays, so
 * `window.visible` stops being the answer to "is this open?" -- a toggle during
 * the fade-out would read `true` and try to close it again. Windows that
 * animate therefore register a setter here, along with the state they intend to
 * be in, and everything that opens or closes a dropdown goes through this
 * module. Windows that do not animate fall through to plain visibility.
 */

interface Controller {
  set: (visible: boolean) => void
  isOpen: () => boolean
}

const controllers = new WeakMap<Astal.Window, Controller>()

export function registerVisibility(window: Astal.Window, controller: Controller): void {
  controllers.set(window, controller)
}

export function isWindowOpen(window: Astal.Window): boolean {
  return controllers.get(window)?.isOpen() ?? window.visible
}

export function setWindowVisible(window: Astal.Window, visible: boolean): void {
  const controller = controllers.get(window)
  if (controller) {
    controller.set(visible)
    return
  }
  window.visible = visible
}

export function toggleWindow(window: Astal.Window): void {
  setWindowVisible(window, !isWindowOpen(window))
}
