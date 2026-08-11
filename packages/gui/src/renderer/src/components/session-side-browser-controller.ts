import { createEffect, createMemo, createSignal, onCleanup, onMount, untrack, type Accessor } from "solid-js"
import { overlayOpen } from "../lib/overlay-registry"
import { workbenchNormalizeBrowserURL } from "../lib/workbench"
import { createNativeBrowserController } from "./native-browser-controller"
import type { OpenTab } from "./session-side-open-types"

export function createSessionSideBrowserController(input: {
  active: Accessor<boolean>
  tabs: Accessor<OpenTab[]>
  activeID: Accessor<string>
  activeTab: Accessor<OpenTab | undefined>
  menuOpen: Accessor<boolean>
  updateTab: (id: string, patch: Partial<OpenTab>) => void
}) {
  const [previewVersion, setPreviewVersion] = createSignal(0)
  const [parkedID, setParkedID] = createSignal("")
  const previews = new Map<string, string>()
  const previewTokens = new Map<string, number>()
  const previewTimers = new Map<string, number>()
  const native = createNativeBrowserController({
    // overlayOpen guards imperative showActive paths (focus, resize restore)
    // that could otherwise re-surface the native view under an open modal.
    active: () => input.active() && !untrack(parkedID) && !overlayOpen(),
    activeID: input.activeID,
    ids: () => input.tabs().filter((tab) => tab.kind === "web").map((tab) => tab.id),
    url: (id) => input.tabs().find((tab) => tab.id === id && tab.kind === "web")?.url,
    applyState: (id, state) => {
      const tab = input.tabs().find((item) => item.id === id)
      if (tab?.kind !== "web") return
      input.updateTab(id, { state, title: state.title || tab.title, input: state.url || tab.input, url: state.url || tab.url, message: "" })
    },
    applyError: (id, message) => input.updateTab(id, { message }),
  })

  const activePreview = createMemo(() => {
    previewVersion()
    const tab = input.activeTab()
    return tab?.kind === "web" ? previews.get(tab.id) : undefined
  })

  onCleanup(() => {
    previewTimers.forEach((timer) => clearTimeout(timer))
    previewTimers.clear()
    previewTokens.clear()
    previews.clear()
  })

  createEffect(() => {
    const tab = input.activeTab()
    // Modals cannot cover the native browser view (it composites above the
    // DOM), so an open overlay parks the browser behind its last preview
    // screenshot until the overlay closes.
    const obscured = input.menuOpen() || overlayOpen()
    const signature = `${input.active() ? "1" : "0"}:${tab?.id ?? ""}:${tab?.kind ?? ""}:${tab?.kind === "web" ? tab.url ?? "" : ""}:${obscured ? "parked" : "ready"}`
    void signature
    if (!input.active() || !tab || tab.kind !== "web") {
      native.hideAll()
      return
    }
    if (obscured) {
      park(tab.id)
      return
    }
    setParkedID("")
    void native.showActive().then(() => refreshPreview(tab.id))
  })

  onMount(() => {
    const parkForResize = () => {
      const tab = input.activeTab()
      if (input.active() && tab?.kind === "web") park(tab.id)
    }
    const restoreAfterResize = () => requestAnimationFrame(() => {
      const tab = input.activeTab()
      if (!input.active() || tab?.kind !== "web") return
      setParkedID("")
      void native.showActive()
    })
    window.addEventListener("opencodex:session-side-panel-resize-start", parkForResize)
    window.addEventListener("opencodex:session-side-panel-resize-end", restoreAfterResize)
    onCleanup(() => {
      window.removeEventListener("opencodex:session-side-panel-resize-start", parkForResize)
      window.removeEventListener("opencodex:session-side-panel-resize-end", restoreAfterResize)
    })
  })

  async function navigate(id: string, value: string) {
    const next = await native.navigate(id, workbenchNormalizeBrowserURL(value))
    if (next) refreshPreview(id)
    return next?.url
  }

  async function action(value: "back" | "forward" | "reload" | "stop") {
    const tab = input.activeTab()
    if (tab?.kind !== "web") return
    const next = await native.action(tab.id, value)
    if (next) refreshPreview(tab.id)
  }

  async function devtools() {
    const tab = input.activeTab()
    if (tab?.kind !== "web") return
    await window.opencodex?.browser?.devtools(tab.id)
  }

  async function openExternal() {
    const tab = input.activeTab()
    if (tab?.kind !== "web" || !tab.url) return false
    return window.opencodex?.browser?.external(tab.url) ?? false
  }

  async function screenshot(id = input.activeID()) {
    return window.opencodex?.browser?.screenshot(id)
  }

  async function capture(id: string, expectedURL: string) {
    return window.opencodex?.browser?.capture({ id, expectedURL })
  }

  async function snapshot(id = input.activeID()) {
    return window.opencodex?.browser?.snapshot(id)
  }

  function close(tab: OpenTab) {
    if (tab.kind !== "web") return
    native.destroy(tab.id)
    const timer = previewTimers.get(tab.id)
    if (timer !== undefined) clearTimeout(timer)
    previewTimers.delete(tab.id)
    previewTokens.delete(tab.id)
    if (previews.delete(tab.id)) setPreviewVersion((current) => current + 1)
  }

  function closeAll(tabs: readonly OpenTab[] = input.tabs()) {
    tabs.forEach(close)
  }

  function parkActive() {
    const tab = input.activeTab()
    if (tab?.kind === "web") park(tab.id)
  }

  function refreshPreview(id: string) {
    const browser = window.opencodex?.browser
    if (!browser) return
    const token = (previewTokens.get(id) ?? 0) + 1
    previewTokens.set(id, token)
    const pending = previewTimers.get(id)
    if (pending !== undefined) clearTimeout(pending)
    previewTimers.set(id, window.setTimeout(() => {
      previewTimers.delete(id)
      void browser.screenshot(id).catch(() => undefined).then((screenshot) => {
        if (!screenshot || previewTokens.get(id) !== token || !input.tabs().some((tab) => tab.id === id)) return
        previews.delete(id)
        previews.set(id, screenshot)
        while (previews.size > 2) previews.delete(previews.keys().next().value!)
        setPreviewVersion((current) => current + 1)
      })
    }, 180))
  }

  function park(id: string) {
    if (parkedID() !== id) setParkedID(id)
    void native.hide(id)
  }

  return {
    activePreview,
    parkedID,
    lifecycle: native.lifecycle,
    error: native.error,
    navigate,
    action,
    devtools,
    openExternal,
    screenshot,
    capture,
    snapshot,
    close,
    closeAll,
    parkActive,
    hideAll: native.hideAll,
    setHost: native.setHost,
  }
}
