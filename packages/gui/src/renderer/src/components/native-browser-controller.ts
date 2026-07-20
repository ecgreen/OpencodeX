import type { Accessor } from "solid-js"
import { createEffect, createSignal, onCleanup } from "solid-js"
import { touchBoundedLRU } from "../lib/resource-limits"

type BrowserBridge = NonNullable<NonNullable<Window["opencodex"]>["browser"]>
type BrowserState = NonNullable<Awaited<ReturnType<BrowserBridge["create"]>>>

export type NativeBrowserLifecycle = "unavailable" | "creating" | "ready" | "loading" | "error" | "hidden" | "destroyed"

const WARM_BROWSER_LIMIT = 4

export function createNativeBrowserController(input: {
  active: Accessor<boolean>
  activeID: Accessor<string>
  ids: Accessor<string[]>
  url: (id: string) => string | undefined
  applyState: (id: string, state: BrowserState) => void
  applyError?: (id: string, message: string) => void
}) {
  const [lifecycle, setLifecycle] = createSignal<NativeBrowserLifecycle>(window.opencodex?.browser ? "hidden" : "unavailable")
  const [error, setError] = createSignal("")
  const createdIDs = new Set<string>()
  const loadedURLByID = new Map<string, string>()
  const requestTokens = new Map<string, number>()
  const boundsAttempts = new Map<string, number>()
  let host: HTMLDivElement | undefined
  let resizeObserver: ResizeObserver | undefined
  let visibleID = ""
  let lastBoundsKey = ""
  let boundsFrame = 0
  let boundsToken = 0
  let hostVersion = 0
  let warmOrder: string[] = []

  const scheduleBounds = () => {
    cancelAnimationFrame(boundsFrame)
    boundsFrame = requestAnimationFrame(() => void showActive())
  }

  const handleVisibility = () => {
    if (document.visibilityState === "visible") return scheduleBounds()
    void hideAll()
  }

  window.addEventListener("resize", scheduleBounds)
  window.addEventListener("focus", scheduleBounds)
  window.visualViewport?.addEventListener("resize", scheduleBounds)
  document.addEventListener("visibilitychange", handleVisibility)

  createEffect(() => {
    const ids = new Set(input.ids())
    Array.from(createdIDs).filter((id) => !ids.has(id)).forEach(destroy)
  })

  onCleanup(() => {
    cancelAnimationFrame(boundsFrame)
    resizeObserver?.disconnect()
    window.removeEventListener("resize", scheduleBounds)
    window.removeEventListener("focus", scheduleBounds)
    window.visualViewport?.removeEventListener("resize", scheduleBounds)
    document.removeEventListener("visibilitychange", handleVisibility)
    Array.from(new Set([...createdIDs, ...requestTokens.keys()])).forEach(destroy)
    loadedURLByID.clear()
    boundsAttempts.clear()
    setLifecycle("destroyed")
  })

  async function ensure(id: string) {
    if (createdIDs.has(id)) return true
    const browser = window.opencodex?.browser
    if (!browser) {
      setLifecycle("unavailable")
      return false
    }
    setLifecycle("creating")
    setError("")
    const token = nextToken(id)
    const next = await browser.create({ id }).catch((cause) => {
      if (requestTokens.get(id) === token) fail(id, cause)
      return undefined
    })
    if (requestTokens.get(id) !== token) return false
    if (!input.ids().includes(id)) {
      if (next) void browser.destroy(id).catch(() => undefined)
      return false
    }
    if (!next) return fail(id, "The desktop browser view could not be created.")
    createdIDs.add(id)
    touchWarm(id)
    input.applyState(id, next)
    setLifecycle(next.loading ? "loading" : "ready")
    return true
  }

  async function showActive() {
    const id = input.activeID()
    if (!input.active() || !id) {
      await hideAll()
      return
    }
    if (!(await ensure(id))) return
    touchWarm(id)
    if (!input.active() || input.activeID() !== id) return hide(id)
    const url = input.url(id)?.trim()
    if (!url) {
      await hide(id)
      setLifecycle("ready")
      return
    }
    if (loadedURLByID.get(id) !== url) return navigate(id, url)
    await syncBounds(id)
    await hideAll(id)
  }

  async function navigate(id: string, url: string) {
    const browser = window.opencodex?.browser
    if (!browser || !(await ensure(id))) return undefined
    const token = nextToken(id)
    setLifecycle("loading")
    setError("")
    const next = await browser.navigate({ id, url }).catch((cause) => {
      if (requestTokens.get(id) === token) fail(id, cause)
      return undefined
    })
    if (requestTokens.get(id) !== token) return undefined
    if (!next) return fail(id, "The page could not be loaded.")
    loadedURLByID.set(id, next.url || url)
    input.applyState(id, next)
    setLifecycle(next.loading ? "loading" : "ready")
    if (input.active() && input.activeID() === id) await syncBounds(id)
    await hideAll(id)
    return next
  }

  async function action(id: string, value: "back" | "forward" | "reload" | "stop") {
    const next = await window.opencodex?.browser?.action({ id, action: value }).catch((cause) => fail(id, cause))
    if (!next || !createdIDs.has(id)) return undefined
    touchWarm(id)
    input.applyState(id, next)
    setLifecycle(next.loading ? "loading" : "ready")
    return next
  }

  async function syncBounds(id: string) {
    const browser = window.opencodex?.browser
    if (!browser || !host || !createdIDs.has(id) || !input.active() || input.activeID() !== id) return
    const target = host
    const version = hostVersion
    const rect = target.getBoundingClientRect()
    if (rect.width < 1 || rect.height < 1) return scheduleBounds()
    const bounds = {
      id,
      x: Math.max(0, Math.round(rect.x)),
      y: Math.max(0, Math.round(rect.y)),
      width: Math.max(1, Math.round(rect.width)),
      height: Math.max(1, Math.round(rect.height)),
    }
    const key = `${id}:${bounds.x}:${bounds.y}:${bounds.width}:${bounds.height}`
    if (visibleID === id && lastBoundsKey === key) return
    const token = ++boundsToken
    const next = await browser.bounds(bounds).catch((cause) => fail(id, cause))
    if (token !== boundsToken) return
    if (version !== hostVersion || host !== target || !input.active() || input.activeID() !== id) {
      await browser.hide(id).catch(() => undefined)
      scheduleBounds()
      return
    }
    if (!next) {
      const attempt = (boundsAttempts.get(id) ?? 0) + 1
      boundsAttempts.set(id, attempt)
      if (attempt < 3) scheduleBounds()
      return
    }
    boundsAttempts.delete(id)
    visibleID = id
    lastBoundsKey = key
    input.applyState(id, next)
    setLifecycle(next.loading ? "loading" : "ready")
  }

  function setHost(element: HTMLDivElement) {
    host = element
    hostVersion += 1
    boundsToken += 1
    resizeObserver?.disconnect()
    resizeObserver = new ResizeObserver(scheduleBounds)
    resizeObserver.observe(element)
    scheduleBounds()
  }

  async function hideAll(exceptID = "") {
    await Promise.all(input.ids().filter((id) => id !== exceptID).map(hide))
  }

  async function hide(id: string) {
    if (visibleID === id) {
      visibleID = ""
      lastBoundsKey = ""
    }
    await window.opencodex?.browser?.hide(id).catch(() => undefined)
    if (input.activeID() === id) setLifecycle(window.opencodex?.browser ? "hidden" : "unavailable")
  }

  function destroy(id: string) {
    const token = nextToken(id)
    createdIDs.delete(id)
    warmOrder = warmOrder.filter((item) => item !== id)
    loadedURLByID.delete(id)
    boundsAttempts.delete(id)
    if (visibleID === id) {
      visibleID = ""
      lastBoundsKey = ""
    }
    const pending = window.opencodex?.browser?.destroy(id)
    if (!pending) {
      requestTokens.delete(id)
      return
    }
    void pending.catch(() => undefined).finally(() => {
      if (requestTokens.get(id) === token && !createdIDs.has(id)) requestTokens.delete(id)
    })
  }

  function destroyAll(ids = Array.from(createdIDs)) {
    ids.forEach(destroy)
  }

  function touchWarm(id: string) {
    const next = touchBoundedLRU(warmOrder, id, WARM_BROWSER_LIMIT, new Set([id]))
    warmOrder = next.order
    next.evicted.forEach(destroy)
  }

  function nextToken(id: string) {
    const token = (requestTokens.get(id) ?? 0) + 1
    requestTokens.set(id, token)
    return token
  }

  function fail(id: string, cause: unknown) {
    const message = cause instanceof Error ? cause.message : typeof cause === "string" ? cause : "The embedded browser encountered an unexpected error."
    setError(message)
    setLifecycle("error")
    input.applyError?.(id, message)
    return undefined
  }

  return { lifecycle, error, showActive, navigate, action, setHost, scheduleBounds, hide, hideAll, destroy, destroyAll }
}
