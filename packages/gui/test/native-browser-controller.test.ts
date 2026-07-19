import { expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { createNativeBrowserController } from "../src/renderer/src/components/native-browser-controller"
import { createSessionSideBrowserController } from "../src/renderer/src/components/session-side-browser-controller"
import type { OpenTab } from "../src/renderer/src/components/session-side-open-types"

test("native browser host mounts through create, navigate, bounds, and hide in order", async () => {
  const calls: string[] = []
  const state = {
    id: "browser-1",
    url: "",
    title: "",
    canGoBack: false,
    canGoForward: false,
    loading: false,
  }
  const environment = installBrowserEnvironment({
    create: async () => {
      calls.push("create")
      return state
    },
    navigate: async (input: { id: string; url: string }) => {
      calls.push("navigate")
      return { ...state, url: input.url }
    },
    bounds: async () => {
      calls.push("bounds")
      return { ...state, url: "https://example.test/" }
    },
    hide: async () => {
      calls.push("hide")
      return state
    },
    destroy: async () => true,
  })
  const [active, setActive] = createSignal(true)
  let dispose = () => undefined
  const controller = createRoot((cleanup) => {
    dispose = cleanup
    return createNativeBrowserController({
      active,
      activeID: () => "browser-1",
      ids: () => ["browser-1"],
      url: () => "https://example.test/",
      applyState: () => undefined,
    })
  })

  try {
    controller.setHost(browserHost())
    await waitFor(() => calls.includes("bounds"))
    expect(calls.slice(0, 3)).toEqual(["create", "navigate", "bounds"])
    expect(controller.lifecycle()).toBe("ready")

    setActive(false)
    await controller.showActive()
    expect(calls.at(-1)).toBe("hide")
    expect(controller.lifecycle()).toBe("hidden")
  } finally {
    dispose()
    environment.restore()
  }
})

test("native browser ignores stale bounds after its host changes", async () => {
  const calls: string[] = []
  let releaseBounds = (_value: unknown) => undefined
  const pendingBounds = new Promise<unknown>((resolve) => {
    releaseBounds = resolve
  })
  const state = {
    id: "browser-1",
    url: "https://example.test/",
    title: "Example",
    canGoBack: false,
    canGoForward: false,
    loading: false,
  }
  const environment = installBrowserEnvironment({
    create: async () => state,
    navigate: async () => state,
    bounds: async () => {
      calls.push("bounds")
      if (calls.length === 1) return pendingBounds as Promise<typeof state>
      return state
    },
    hide: async () => {
      calls.push("hide")
      return state
    },
    destroy: async () => true,
  })
  let dispose = () => undefined
  const controller = createRoot((cleanup) => {
    dispose = cleanup
    return createNativeBrowserController({
      active: () => true,
      activeID: () => "browser-1",
      ids: () => ["browser-1"],
      url: () => "https://example.test/",
      applyState: () => undefined,
    })
  })

  try {
    controller.setHost(browserHost(10))
    await waitFor(() => calls.includes("bounds"))
    controller.setHost(browserHost(40))
    releaseBounds(state)
    await waitFor(() => calls.filter((call) => call === "bounds").length === 2)
    expect(calls.filter((call) => call === "bounds")).toHaveLength(2)
  } finally {
    dispose()
    environment.restore()
  }
})

test("session browser stays parked while its workspace is resizing", async () => {
  const calls: string[] = []
  const state = {
    id: "browser-1",
    url: "https://example.test/",
    title: "Example",
    canGoBack: false,
    canGoForward: false,
    loading: false,
  }
  const environment = installBrowserEnvironment({
    create: async () => state,
    navigate: async () => state,
    bounds: async () => {
      calls.push("bounds")
      return state
    },
    hide: async () => {
      calls.push("hide")
      return state
    },
    screenshot: async () => undefined,
    destroy: async () => true,
  })
  const [tabs, setTabs] = createSignal<OpenTab[]>([{ id: "browser-1", input: state.url, title: state.title, kind: "web", url: state.url, text: "", original: "" }])
  let dispose = () => undefined
  const controller = createRoot((cleanup) => {
    dispose = cleanup
    return createSessionSideBrowserController({
      active: () => true,
      tabs,
      activeID: () => "browser-1",
      activeTab: () => tabs()[0],
      menuOpen: () => false,
      updateTab: (id, patch) => setTabs((current) => current.map((tab) => tab.id === id ? { ...tab, ...patch } : tab)),
    })
  })

  try {
    controller.setHost(browserHost())
    await waitFor(() => calls.includes("bounds"))
    window.dispatchEvent(new Event("opencodex:session-side-panel-resize-start"))
    await waitFor(() => calls.includes("hide"))
    const boundsCount = calls.filter((call) => call === "bounds").length
    environment.resize()
    await Bun.sleep(5)
    expect(calls.filter((call) => call === "bounds")).toHaveLength(boundsCount)

    window.dispatchEvent(new Event("opencodex:session-side-panel-resize-end"))
    await waitFor(() => calls.filter((call) => call === "bounds").length > boundsCount)
  } finally {
    dispose()
    environment.restore()
  }
})

function browserHost(x = 10) {
  return {
    getBoundingClientRect: () => ({ x, y: 20, width: 800, height: 600 }),
  } as HTMLDivElement
}

async function waitFor(predicate: () => boolean) {
  for (const _ of Array.from({ length: 50 })) {
    if (predicate()) return
    await Bun.sleep(1)
  }
  throw new Error("Timed out waiting for native browser lifecycle")
}

function installBrowserEnvironment(browser: Record<string, unknown>) {
  const names = ["window", "document", "requestAnimationFrame", "cancelAnimationFrame", "ResizeObserver"] as const
  const descriptors = new Map(names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]))
  const events = new EventTarget()
  const resizeCallbacks = new Set<ResizeObserverCallback>()
  let frame = 0
  Object.defineProperties(globalThis, {
    window: {
      configurable: true,
      value: {
        opencodex: { browser },
        addEventListener: events.addEventListener.bind(events),
        removeEventListener: events.removeEventListener.bind(events),
        dispatchEvent: events.dispatchEvent.bind(events),
        setTimeout,
        visualViewport: { addEventListener: () => undefined, removeEventListener: () => undefined },
      },
    },
    document: {
      configurable: true,
      value: {
        visibilityState: "visible",
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      },
    },
    requestAnimationFrame: {
      configurable: true,
      value: (callback: FrameRequestCallback) => {
        const id = ++frame
        queueMicrotask(() => callback(performance.now()))
        return id
      },
    },
    cancelAnimationFrame: { configurable: true, value: () => undefined },
    ResizeObserver: {
      configurable: true,
      value: class {
        constructor(callback: ResizeObserverCallback) {
          resizeCallbacks.add(callback)
        }
        observe() {}
        disconnect() {}
      },
    },
  })
  return {
    resize() {
      resizeCallbacks.forEach((callback) => callback([], {} as ResizeObserver))
    },
    restore() {
      descriptors.forEach((descriptor, name) => {
        if (descriptor) return Object.defineProperty(globalThis, name, descriptor)
        Reflect.deleteProperty(globalThis, name)
      })
    },
  }
}
