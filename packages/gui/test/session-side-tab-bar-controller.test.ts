import { describe, expect, test } from "bun:test"
import { createElementResizeTracker } from "../src/renderer/src/lib/element-resize-tracker"

/**
 * Regression coverage for workspace tabs collapsing into "... N tabs" after a
 * session switch. The tab bar view unmounts when a session without tabs shows,
 * and remounts with a NEW element on return. The controller's ResizeObserver
 * used to stay attached to the old, detached element, so the width measured
 * mid-remount (zero, while the side panel was still animating open) latched
 * and every tab spilled into the overflow menu. The tracker keeps the observer
 * on the latest element so the settled width always re-measures.
 */
describe("element resize tracker", () => {
  test("measures immediately when an element is tracked", () => {
    const environment = installResizeObserver()
    try {
      let measures = 0
      const tracker = createElementResizeTracker(() => { measures += 1 })
      tracker.track(element())
      expect(measures).toBe(1)
    } finally {
      environment.restore()
    }
  })

  test("follows the latest element across remounts", () => {
    const environment = installResizeObserver()
    try {
      let measures = 0
      const tracker = createElementResizeTracker(() => { measures += 1 })
      const first = element()
      const remounted = element()
      tracker.track(first)
      tracker.track(remounted)

      // The stale element resizing must not measure; the live one must.
      const baseline = measures
      environment.resize(first)
      expect(measures).toBe(baseline)
      environment.resize(remounted)
      expect(measures).toBe(baseline + 1)
    } finally {
      environment.restore()
    }
  })

  test("re-tracking the same element does not rebind or measure again", () => {
    const environment = installResizeObserver()
    try {
      let measures = 0
      const tracker = createElementResizeTracker(() => { measures += 1 })
      const bar = element()
      tracker.track(bar)
      tracker.track(bar)
      expect(measures).toBe(1)
      environment.resize(bar)
      expect(measures).toBe(2)
    } finally {
      environment.restore()
    }
  })

  test("dispose stops observing entirely", () => {
    const environment = installResizeObserver()
    try {
      let measures = 0
      const tracker = createElementResizeTracker(() => { measures += 1 })
      const bar = element()
      tracker.track(bar)
      tracker.dispose()
      const baseline = measures
      environment.resize(bar)
      expect(measures).toBe(baseline)
    } finally {
      environment.restore()
    }
  })

  test("tolerates environments without ResizeObserver", () => {
    const environment = installResizeObserver()
    Reflect.deleteProperty(globalThis, "ResizeObserver")
    try {
      let measures = 0
      const tracker = createElementResizeTracker(() => { measures += 1 })
      tracker.track(element())
      expect(measures).toBe(1)
      tracker.dispose()
    } finally {
      environment.restore()
    }
  })
})

function element() {
  return {} as unknown as Element
}

function installResizeObserver() {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "ResizeObserver")
  const observers = new Set<{ callback: ResizeObserverCallback; targets: Set<unknown> }>()
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: class {
      callback: ResizeObserverCallback
      targets = new Set<unknown>()
      constructor(callback: ResizeObserverCallback) {
        this.callback = callback
        observers.add(this)
      }
      observe(target: unknown) {
        this.targets.add(target)
      }
      unobserve(target: unknown) {
        this.targets.delete(target)
      }
      disconnect() {
        this.targets.clear()
      }
    },
  })
  return {
    resize(target: unknown) {
      observers.forEach((observer) => {
        if (observer.targets.has(target)) observer.callback([], observer as unknown as ResizeObserver)
      })
    },
    restore() {
      if (descriptor) {
        Object.defineProperty(globalThis, "ResizeObserver", descriptor)
        return
      }
      Reflect.deleteProperty(globalThis, "ResizeObserver")
    },
  }
}
