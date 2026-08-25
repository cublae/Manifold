import { getScope } from "ags"

/**
 * Build widgets after an await, inside the scope that was current when the
 * component was constructed.
 *
 * gnim ties a widget's cleanup to a reactive scope, and that scope is only
 * current while a component is being built. Manifold fills parts of its UI in
 * from async service loads, which resume long after the scope has gone --
 * creating a widget there fails with "out of tracking context". Capturing the
 * scope up front and re-entering it for the construction keeps automatic
 * cleanup working, which is the whole reason v3 tracks scopes at all.
 *
 * `build` must wrap the widget construction itself, not the awaits around it.
 */
export function deferred(
  work: (build: <T>(fn: () => T) => T) => Promise<unknown>,
): void {
  const scope = getScope()
  const build = <T,>(fn: () => T): T => scope.run(fn)

  void Promise.resolve(work(build)).catch((error) => {
    console.error(`manifold: deferred build failed: ${error}`)
  })
}

/**
 * Capture the current scope as a runner usable after any number of awaits.
 *
 * Call this synchronously while the component is being built, then wrap each
 * later widget construction in the returned function.
 */
export function captureScope(): <T>(fn: () => T) => T {
  const scope = getScope()
  return <T,>(fn: () => T): T => scope.run(fn)
}
