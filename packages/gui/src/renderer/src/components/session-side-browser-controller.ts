import { createEffect, createMemo, createSignal, onCleanup, onMount, type Accessor } from "solid-js"
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
  const [previewByID, setPreviewByID] = createSignal<Record<string, string>>({})
  const [parkedID, setParkedID] = createSignal("")
  const previewTokens = new Map<string, number>()
  const native = createNativeBrowserController({
    active: input.active,
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
    const tab = input.activeTab()
    return tab?.kind === "web" ? previewByID()[tab.id] : undefined
  })

  createEffect(() => {
    const tab = input.activeTab()
    const signature = `${input.active() ? "1" : "0"}:${tab?.id ?? ""}:${tab?.kind ?? ""}:${tab?.kind === "web" ? tab.url ?? "" : ""}:${input.menuOpen() ? "menu" : "ready"}`
    void signature
    if (!input.active() || !tab || tab.kind !== "web") {
      native.hideAll()
      return
    }
    if (input.menuOpen()) {
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
  }

  async function action(value: "back" | "forward" | "reload" | "stop") {
    const tab = input.activeTab()
    if (tab?.kind !== "web") return
    const next = await native.action(tab.id, value)
    if (next) refreshPreview(tab.id)
  }

  function close(tab: OpenTab) {
    if (tab.kind !== "web") return
    native.destroy(tab.id)
    previewTokens.delete(tab.id)
    setPreviewByID((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== tab.id)))
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
    window.setTimeout(() => void browser.screenshot(id).catch(() => undefined).then((screenshot) => {
      if (!screenshot || previewTokens.get(id) !== token || !input.tabs().some((tab) => tab.id === id)) return
      setPreviewByID((current) => ({ ...current, [id]: screenshot }))
    }), 180)
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
    close,
    parkActive,
    hideAll: native.hideAll,
    setHost: native.setHost,
  }
}
