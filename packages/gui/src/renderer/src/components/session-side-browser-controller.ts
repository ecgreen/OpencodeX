import { createEffect, createMemo, createSignal, onCleanup, onMount, type Accessor } from "solid-js"
import { workbenchNormalizeBrowserURL } from "../lib/workbench"
import { inputLabel } from "./session-side-path"
import { openTabDefaults } from "./session-side-open-state"
import type { OpenTab } from "./session-side-open-types"

export function createSessionSideBrowserController(input: {
  active: Accessor<boolean>
  tabs: Accessor<OpenTab[]>
  activeID: Accessor<string>
  activeTab: Accessor<OpenTab | undefined>
  menuOpen: Accessor<boolean>
  updateTab: (id: string, patch: Partial<OpenTab>) => void
}) {
  const [previewByID, setPreviewByID] = createSignal<Record<string, string>>({})
  const [parkedID, setParkedID] = createSignal("")
  const createdIDs = new Set<string>()
  const loadedURLByID = new Map<string, string>()
  const loadTokens = new Map<string, number>()
  const previewTokens = new Map<string, number>()
  let host: HTMLDivElement | undefined
  let resizeObserver: ResizeObserver | undefined
  let visibleID = ""
  let lastBoundsKey = ""
  let boundsFrame = 0

  const activePreview = createMemo(() => {
    const tab = input.activeTab()
    return tab?.kind === "web" ? previewByID()[tab.id] : undefined
  })

  createEffect(() => {
    const tab = input.activeTab()
    const signature = `${input.active() ? "1" : "0"}:${tab?.id ?? ""}:${tab?.kind ?? ""}:${tab?.kind === "web" ? tab.url ?? "" : ""}:${input.menuOpen() ? "menu" : "ready"}`
    void signature
    if (!input.active() || !tab || tab.kind !== "web") {
      hideAll()
      return
    }
    if (input.menuOpen()) {
      park(tab.id)
      return
    }
    void show(tab)
  })

  onMount(() => {
    const schedule = () => scheduleBounds()
    const parkForResize = () => {
      const tab = input.activeTab()
      if (input.active() && tab?.kind === "web") park(tab.id)
    }
    const restoreAfterResize = () => requestAnimationFrame(() => {
      const tab = input.activeTab()
      if (!input.active() || tab?.kind !== "web") return
      setParkedID("")
      void show(tab)
    })
    const visible = () => {
      if (document.visibilityState === "visible") schedule()
      else hideAll()
    }
    window.addEventListener("resize", schedule)
    window.addEventListener("focus", schedule)
    window.visualViewport?.addEventListener("resize", schedule)
    document.addEventListener("visibilitychange", visible)
    window.addEventListener("opencodex:session-side-panel-resize-start", parkForResize)
    window.addEventListener("opencodex:session-side-panel-resize-end", restoreAfterResize)
    onCleanup(() => {
      window.removeEventListener("resize", schedule)
      window.removeEventListener("focus", schedule)
      window.visualViewport?.removeEventListener("resize", schedule)
      document.removeEventListener("visibilitychange", visible)
      window.removeEventListener("opencodex:session-side-panel-resize-start", parkForResize)
      window.removeEventListener("opencodex:session-side-panel-resize-end", restoreAfterResize)
    })
  })

  onCleanup(() => {
    cancelAnimationFrame(boundsFrame)
    resizeObserver?.disconnect()
    hideAll()
    createdIDs.forEach((id) => void window.opencodex?.browser?.destroy(id))
    createdIDs.clear()
  })

  async function navigate(id: string, value: string) {
    const url = workbenchNormalizeBrowserURL(value)
    if (!(await ensure(input.tabs().find((tab) => tab.id === id) ?? openTabDefaults(id)))) return
    await loadURL(id, url)
    if (input.activeID() === id && input.activeTab()?.kind === "web" && !input.menuOpen()) scheduleBounds()
  }

  async function action(action: "back" | "forward" | "reload" | "stop") {
    const tab = input.activeTab()
    if (tab?.kind !== "web") return
    const next = await window.opencodex?.browser?.action({ id: tab.id, action })
    if (next) input.updateTab(tab.id, { state: next, title: next.title || tab.title, input: next.url || tab.input, url: next.url || tab.url })
    refreshPreview(tab.id)
  }

  function close(tab: OpenTab) {
    if (tab.kind !== "web") return
    hide(tab.id)
    if (createdIDs.delete(tab.id)) void window.opencodex?.browser?.destroy(tab.id)
    loadedURLByID.delete(tab.id)
    loadTokens.delete(tab.id)
    previewTokens.delete(tab.id)
    setPreviewByID((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== tab.id)))
  }

  function parkActive() {
    const tab = input.activeTab()
    if (tab?.kind === "web") park(tab.id)
  }

  function setHost(element: HTMLDivElement) {
    host = element
    resizeObserver?.disconnect()
    resizeObserver = new ResizeObserver(scheduleBounds)
    resizeObserver.observe(element)
    scheduleBounds()
  }

  async function ensure(tab: OpenTab) {
    if (createdIDs.has(tab.id)) return true
    const browser = window.opencodex?.browser
    if (!browser) {
      input.updateTab(tab.id, { message: "Embedded browser is not available." })
      return false
    }
    const next = await browser.create({ id: tab.id }).catch(() => undefined)
    createdIDs.add(tab.id)
    if (next) input.updateTab(tab.id, { state: next, title: next.title || tab.title, input: next.url || tab.input, url: next.url || tab.url, message: "" })
    return true
  }

  async function show(tab: OpenTab) {
    if (!tab.url || !(await ensure(tab))) return
    const current = input.tabs().find((item) => item.id === tab.id)
    if (!input.active() || input.menuOpen() || input.activeID() !== tab.id || current?.kind !== "web") return
    const url = current.url ?? tab.url
    if (url && loadedURLByID.get(tab.id) !== url) await loadURL(tab.id, url)
    if (!input.active() || input.menuOpen() || input.activeID() !== tab.id) return
    setParkedID("")
    syncBounds(tab.id)
    hideAll(tab.id)
  }

  async function loadURL(id: string, url: string) {
    const browser = window.opencodex?.browser
    if (!browser) {
      input.updateTab(id, { message: "Embedded browser is not available." })
      return
    }
    const token = (loadTokens.get(id) ?? 0) + 1
    loadTokens.set(id, token)
    loadedURLByID.set(id, url)
    const next = await browser.navigate({ id, url }).catch(() => undefined)
    if (loadTokens.get(id) !== token || !next) return
    loadedURLByID.set(id, next.url || url)
    input.updateTab(id, { state: next, title: next.title || inputLabel(next.url || url), input: next.url || url, url: next.url || url, message: "" })
    refreshPreview(id)
  }

  function scheduleBounds() {
    cancelAnimationFrame(boundsFrame)
    boundsFrame = requestAnimationFrame(() => {
      const tab = input.activeTab()
      if (!input.active() || input.menuOpen() || tab?.kind !== "web") return
      syncBounds(tab.id)
    })
  }

  function syncBounds(id: string) {
    const browser = window.opencodex?.browser
    if (!host || !browser) return
    const rect = host.getBoundingClientRect()
    const bounds = { id, x: Math.round(rect.x), y: Math.round(rect.y), width: Math.max(1, Math.round(rect.width)), height: Math.max(1, Math.round(rect.height)) }
    const key = `${id}:${bounds.x}:${bounds.y}:${bounds.width}:${bounds.height}`
    if (visibleID === id && lastBoundsKey === key) return
    visibleID = id
    lastBoundsKey = key
    void browser.bounds(bounds).then((next) => {
      const tab = input.tabs().find((item) => item.id === id)
      if (next && tab?.kind === "web") input.updateTab(id, { state: next, title: next.title || tab.title, input: next.url || tab.input, url: next.url || tab.url })
    })
  }

  function refreshPreview(id: string) {
    const browser = window.opencodex?.browser
    if (!browser) return
    const token = (previewTokens.get(id) ?? 0) + 1
    previewTokens.set(id, token)
    window.setTimeout(() => void browser.screenshot(id).catch(() => undefined).then((screenshot) => {
      if (!screenshot || previewTokens.get(id) !== token || !input.tabs().some((tab) => tab.id === id)) return
      setPreviewByID((current) => ({ ...current, [id]: screenshot }))
    }), 180)
  }

  function park(id: string) {
    if (parkedID() !== id) setParkedID(id)
    hide(id)
  }

  function hide(id: string) {
    if (visibleID === id) {
      visibleID = ""
      lastBoundsKey = ""
    }
    void window.opencodex?.browser?.hide(id)
  }

  function hideAll(exceptID = "") {
    input.tabs().filter((tab) => tab.kind === "web" && tab.id !== exceptID).forEach((tab) => hide(tab.id))
  }

  return { activePreview, parkedID, navigate, action, close, parkActive, hideAll, setHost }
}
