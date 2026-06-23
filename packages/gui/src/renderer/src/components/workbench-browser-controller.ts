import { createMemo, createSignal, onCleanup, type Setter } from "solid-js"
import {
  activeWorkbenchBrowserTab,
  addWorkbenchArtifact,
  addWorkbenchBrowserTab,
  closeWorkbenchBrowserTab,
  updateWorkbenchBrowserTabState,
  updateWorkbenchBrowserTabURL,
  workbenchBrowserPageArtifact,
  workbenchBrowserTabLabel,
  workbenchNormalizeBrowserURL,
  type WorkbenchArtifact,
  type WorkbenchBrowserTab,
  type WorkbenchTab,
} from "../lib/workbench"
import { newBrowserID } from "./workbench-page-helpers"

export function createWorkbenchBrowserController(input: {
  initialTabs: WorkbenchBrowserTab[]
  initialActiveID: string
  setArtifacts: Setter<WorkbenchArtifact[]>
  setNotice: Setter<string>
  setTab: Setter<WorkbenchTab>
}) {
  const [tabs, setTabs] = createSignal<WorkbenchBrowserTab[]>(input.initialTabs)
  const [activeID, setActiveID] = createSignal(input.initialActiveID)
  const activeTab = createMemo(() => activeWorkbenchBrowserTab(tabs(), activeID()))
  const id = createMemo(() => activeTab()?.id ?? activeID())
  const url = createMemo(() => activeTab()?.url ?? "")
  const state = createMemo(() => activeTab()?.state)
  const createdIDs = new Set<string>()
  let host: HTMLDivElement | undefined
  let resizeObserver: ResizeObserver | undefined

  onCleanup(() => {
    resizeObserver?.disconnect()
    tabs().forEach((item) => void window.opencodex?.browser?.destroy(item.id))
  })

  async function ensure() {
    const browser = window.opencodex?.browser
    const current = activeTab()
    if (!browser || !current) return
    const next = await browser.create({ id: current.id, url: createdIDs.has(current.id) ? undefined : current.url })
    createdIDs.add(current.id)
    if (next) setTabs((items) => updateWorkbenchBrowserTabState(items, next))
  }

  function updateBounds() {
    if (!host || !window.opencodex?.browser) return
    const rect = host.getBoundingClientRect()
    void window.opencodex.browser.bounds({
      id: id(),
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    }).then((next) => {
      if (next) setTabs((items) => updateWorkbenchBrowserTabState(items, next))
    })
    hideTabs(id())
    if (resizeObserver) return
    resizeObserver = new ResizeObserver(updateBounds)
    resizeObserver.observe(host)
  }

  function hideTabs(exceptID = "") {
    tabs().filter((item) => item.id !== exceptID).forEach((item) => {
      void window.opencodex?.browser?.bounds({ id: item.id, x: 0, y: 0, width: 1, height: 1 })
    })
  }

  async function navigate() {
    const browser = window.opencodex?.browser
    if (!browser) return
    const nextURL = workbenchNormalizeBrowserURL(url())
    setTabs((items) => updateWorkbenchBrowserTabURL(items, id(), nextURL))
    const next = await browser.navigate({ id: id(), url: nextURL })
    createdIDs.add(id())
    if (next) setTabs((items) => updateWorkbenchBrowserTabState(items, next))
  }

  async function action(action: "back" | "forward" | "reload" | "stop") {
    const next = await window.opencodex?.browser?.action({ id: id(), action })
    if (next) setTabs((items) => updateWorkbenchBrowserTabState(items, next))
  }

  async function captureScreenshot() {
    const screenshotURL = await window.opencodex?.browser?.screenshot(id())
    if (!screenshotURL) return
    input.setArtifacts((items) => addWorkbenchArtifact(items, {
      kind: "screenshot",
      title: state()?.title || state()?.url || "Browser screenshot",
      url: screenshotURL,
    }))
    input.setNotice("Captured browser screenshot.")
  }

  function savePageArtifact() {
    const artifact = workbenchBrowserPageArtifact({
      url: state()?.url || url(),
      title: state()?.title || workbenchBrowserTabLabel(activeTab()),
    })
    if (!artifact) {
      input.setNotice("Open a browser page before saving it as an artifact.")
      return
    }
    input.setArtifacts((items) => addWorkbenchArtifact(items, artifact))
    input.setNotice("Saved browser page artifact.")
  }

  function setURL(value: string) {
    setTabs((items) => updateWorkbenchBrowserTabURL(items, id(), value))
  }

  function createTab(url = "http://localhost:5173", title = "New tab") {
    const nextID = newBrowserID()
    setTabs((items) => addWorkbenchBrowserTab(items, { id: nextID, url: workbenchNormalizeBrowserURL(url), title }))
    setActiveID(nextID)
  }

  function openURL(nextURL: string | undefined, title = "New tab") {
    if (!nextURL) return
    createTab(nextURL, title)
    input.setTab("browser")
  }

  function closeTab(id: string) {
    const next = closeWorkbenchBrowserTab(tabs(), activeID(), id)
    const fallback = next.tabs.length === 0 ? { id: newBrowserID(), url: "http://localhost:5173", title: "New tab" } : undefined
    setTabs(fallback ? [fallback] : next.tabs)
    setActiveID(fallback?.id ?? next.activeID)
    createdIDs.delete(id)
    void window.opencodex?.browser?.destroy(id)
  }

  return {
    tabs,
    activeID,
    setActiveID,
    activeTab,
    id,
    url,
    state,
    ensure,
    updateBounds,
    hideTabs,
    navigate,
    action,
    captureScreenshot,
    savePageArtifact,
    setURL,
    createTab,
    openURL,
    closeTab,
    setHost: (element: HTMLDivElement) => { host = element },
  }
}
