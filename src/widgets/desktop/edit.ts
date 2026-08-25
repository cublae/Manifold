import { createState } from "ags"

/**
 * Whether the desktop is being rearranged.
 *
 * One flag for the whole shell rather than one per monitor: the control centre
 * has a single button, and a mode that were on for one screen and off for
 * another would be a puzzle rather than a feature. Every desktop surface
 * watches this and lets itself be dragged while it is set.
 */

const [editing, setEditing] = createState(false)

export { editing }

export function setEditingDesktop(value: boolean): void {
  setEditing(value)
}

export function toggleEditingDesktop(): boolean {
  const next = !editing.get()
  setEditing(next)
  return next
}
