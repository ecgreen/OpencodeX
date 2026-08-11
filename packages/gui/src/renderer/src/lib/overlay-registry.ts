import { createEffect, createSignal, onCleanup, type Accessor } from "solid-js"

/**
 * The embedded browser is a native Electron child view (WebContentsView) that
 * composites above the entire renderer DOM, so a portal-rendered modal can
 * never out-stack it with z-index. Modal surfaces raise this shared signal
 * while they are open; the browser controller treats it as a park condition
 * and hides the native view until the last overlay closes.
 */
const [overlayCount, setOverlayCount] = createSignal(0)

export const overlayOpen: Accessor<boolean> = () => overlayCount() > 0

/** Raise the overlay signal. Returns a release that is safe to call twice. */
export function acquireOverlay() {
  setOverlayCount((count) => count + 1)
  let released = false
  return () => {
    if (released) return
    released = true
    setOverlayCount((count) => Math.max(0, count - 1))
  }
}

/** For components that ARE the overlay - mounted only while open. */
export function registerOverlay() {
  onCleanup(acquireOverlay())
}

/** For always-mounted components that show their overlay off an `open` prop. */
export function trackOverlay(open: Accessor<boolean>) {
  createEffect(() => {
    if (!open()) return
    onCleanup(acquireOverlay())
  })
}
