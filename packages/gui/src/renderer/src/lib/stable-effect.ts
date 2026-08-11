import { createEffect, createSignal, onCleanup } from "solid-js"

/**
 * A reactive cycle must never be able to hang the window.
 *
 * An effect that writes a signal it also reads re-runs on its own write. That
 * is usually fine - the write converges and the second run is a no-op - but if
 * two runs ever disagree, Solid's update queue spins synchronously and the whole
 * renderer stops answering: no paint, no input, no way out but killing the app.
 * The effects wrapped here are the ones that legitimately write state they also
 * depend on, so they are the ones that could do it.
 *
 * `createStableEffect` bounds that:
 *
 * - Re-runs are counted within a single synchronous flush. A microtask cannot
 *   run while the queue is spinning, so "the counter was never reset" is exactly
 *   the signal that we are inside one.
 * - Past the limit the body stops running, which stops the writes, which ends
 *   the flush. The window paints and accepts input again.
 * - The effect is then woken on a *timer*, not a microtask - a microtask chain
 *   would starve the event loop just as thoroughly as the spin did. A cycle that
 *   keeps re-forming backs off geometrically, so the pathological case costs one
 *   short burst per second rather than the machine.
 *
 * Waking up matters as much as stopping: the body has to run again to re-read
 * its dependencies, or Solid drops the effect's subscriptions and the pane it
 * drives is dead for the rest of the session.
 *
 * The limit sits far above any honest convergence: settling takes two runs, and
 * a chain of derived signals a few more.
 */
export const STABLE_EFFECT_RERUN_LIMIT = 32
const RESUME_BASE_MS = 16
const RESUME_MAX_MS = 1_000

export type StableEffectReport = { name: string; runs: number; breaks: number }

const defaultReporter = (detail: StableEffectReport) => {
  console.error(
    `[opencodex] Reactive cycle in "${detail.name}": ${detail.runs} synchronous re-runs ` +
      `(break #${detail.breaks}). Paused for the rest of this flush to keep the window responsive.`,
  )
}
let report: (detail: StableEffectReport) => void = defaultReporter

/** Test seam. Returns a restore function. */
export function setStableEffectReporter(next: (detail: StableEffectReport) => void) {
  const previous = report
  report = next
  return () => {
    report = previous
  }
}

export function createStableEffect(name: string, fn: () => void) {
  // Read on every run so the effect keeps a dependency even when the body is
  // skipped - without it Solid would drop its subscriptions and never wake up.
  const [resume, setResume] = createSignal(0)
  let runs = 0
  let resetQueued = false
  let paused = false
  /** Consecutive flushes broken, for the backoff. Cleared by a clean flush. */
  let breaks = 0
  let resumeTimer: ReturnType<typeof setTimeout> | undefined

  createEffect(() => {
    resume()
    runs += 1
    if (!resetQueued) {
      resetQueued = true
      queueMicrotask(() => {
        resetQueued = false
        const broke = paused
        runs = 0
        if (!broke) {
          breaks = 0
          return
        }
        resumeTimer = setTimeout(
          () => {
            resumeTimer = undefined
            paused = false
            setResume((value) => value + 1)
          },
          Math.min(RESUME_MAX_MS, RESUME_BASE_MS * 2 ** (breaks - 1)),
        )
      })
    }
    if (runs > STABLE_EFFECT_RERUN_LIMIT) {
      if (paused) return
      paused = true
      breaks += 1
      report({ name, runs, breaks })
      return
    }
    fn()
  })

  onCleanup(() => {
    if (resumeTimer !== undefined) clearTimeout(resumeTimer)
  })
}
