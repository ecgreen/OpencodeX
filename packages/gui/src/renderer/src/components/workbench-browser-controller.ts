import type { Accessor, Setter } from "solid-js"
import { createMemo, createSignal } from "solid-js"
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
import { createNativeBrowserController } from "./native-browser-controller"
import { newBrowserID } from "./workbench-page-helpers"

export function createWorkbenchBrowserController(input: {
  active: Accessor<boolean>
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
  const native = createNativeBrowserController({
    active: input.active,
    activeID: id,
    ids: () => tabs().map((tab) => tab.id),
    url: (browserID) => tabs().find((tab) => tab.id === browserID)?.url,
    applyState: (_browserID, next) => setTabs((items) => updateWorkbenchBrowserTabState(items, next)),
    applyError: (_browserID, message) => input.setNotice(message),
  })

  async function navigate() {
    const nextURL = workbenchNormalizeBrowserURL(url())
    setTabs((items) => updateWorkbenchBrowserTabURL(items, id(), nextURL))
    await native.navigate(id(), nextURL)
  }

  async function action(value: "back" | "forward" | "reload" | "stop") {
    await native.action(id(), value)
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

  function createTab(nextURL = "", title = "New tab") {
    const nextID = newBrowserID()
    setTabs((items) => addWorkbenchBrowserTab(items, { id: nextID, url: workbenchNormalizeBrowserURL(nextURL), title }))
    setActiveID(nextID)
  }

  function openURL(nextURL: string | undefined, title = "New tab") {
    if (!nextURL) return
    createTab(nextURL, title)
    input.setTab("browser")
  }

  function closeTab(browserID: string) {
    const next = closeWorkbenchBrowserTab(tabs(), activeID(), browserID)
    const fallback = next.tabs.length === 0 ? { id: newBrowserID(), url: "", title: "New tab" } : undefined
    setTabs(fallback ? [fallback] : next.tabs)
    setActiveID(fallback?.id ?? next.activeID)
    native.destroy(browserID)
  }

  return {
    tabs,
    activeID,
    setActiveID,
    activeTab,
    id,
    url,
    state,
    lifecycle: native.lifecycle,
    error: native.error,
    showActive: native.showActive,
    hideTabs: native.hideAll,
    navigate,
    action,
    captureScreenshot,
    savePageArtifact,
    setURL,
    createTab,
    openURL,
    closeTab,
    setHost: native.setHost,
  }
}
