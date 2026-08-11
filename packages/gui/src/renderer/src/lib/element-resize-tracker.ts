/**
 * Keeps one ResizeObserver attached to the latest element a view hands over,
 * measuring immediately on every handover.
 *
 * Views that unmount and remount (the workspace tab bar disappears while a
 * session without tabs shows) call their ref again with a NEW element. An
 * observer bound once at mount keeps watching the old, detached node, so the
 * width measured mid-remount - zero, while the panel is still animating open -
 * latches and never corrects. Tracking the handover instead guarantees the
 * settled size of the live element always re-measures.
 */
export function createElementResizeTracker(measure: () => void) {
  let observer: ResizeObserver | undefined
  let current: Element | undefined
  return {
    track(element: Element) {
      if (element === current) return
      current = element
      observer ??= typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure)
      observer?.disconnect()
      observer?.observe(element)
      measure()
    },
    dispose() {
      observer?.disconnect()
      observer = undefined
      current = undefined
    },
  }
}
