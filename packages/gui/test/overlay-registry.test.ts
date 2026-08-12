import { describe, expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { acquireOverlay, overlayOpen, registerOverlay, trackOverlay } from "../src/renderer/src/lib/overlay-registry"

/**
 * The embedded browser is a native Electron child view that composites above
 * the entire renderer DOM, so no z-index can put a modal over it. The overlay
 * registry is the single signal modal surfaces raise so the browser view can
 * park (hide behind its screenshot preview) while any modal is open.
 */
describe("overlay registry", () => {
  test("counts acquisitions and ignores double release", () => {
    expect(overlayOpen()).toBe(false)
    const releaseFirst = acquireOverlay()
    const releaseSecond = acquireOverlay()
    expect(overlayOpen()).toBe(true)
    releaseFirst()
    releaseFirst()
    expect(overlayOpen()).toBe(true)
    releaseSecond()
    expect(overlayOpen()).toBe(false)
  })

  test("registerOverlay releases when the overlay component is disposed", () => {
    expect(overlayOpen()).toBe(false)
    const dispose = createRoot((dispose) => {
      registerOverlay()
      return dispose
    })
    expect(overlayOpen()).toBe(true)
    dispose()
    expect(overlayOpen()).toBe(false)
  })

  test("trackOverlay follows an open signal on an always-mounted component", () => {
    const [open, setOpen] = createSignal(false)
    let dispose!: () => void
    createRoot((disposer) => {
      dispose = disposer
      trackOverlay(open)
    })
    expect(overlayOpen()).toBe(false)
    setOpen(true)
    expect(overlayOpen()).toBe(true)
    setOpen(false)
    expect(overlayOpen()).toBe(false)
    setOpen(true)
    expect(overlayOpen()).toBe(true)
    dispose()
    expect(overlayOpen()).toBe(false)
  })
})
