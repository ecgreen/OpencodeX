import { createEffect, onCleanup, type Accessor } from "solid-js"
import { workbenchNormalizeBrowserURL } from "../lib/workbench"
import { registerSessionWorkspaceRequestHandler, type SessionWorkspaceRequest, type SessionWorkspaceResult } from "../lib/session-workspace-bridge"
import { compactPath } from "../lib/format"
import { filePathFromInput, inputLabel } from "./session-side-path"
import { openTabFileIdentity } from "./session-side-open-state"
import type { OpenFileTarget, OpenTab } from "./session-side-open-types"

export function createSessionSideAgentController(input: {
  enabled?: Accessor<boolean>
  sessionID: Accessor<string>
  directory: Accessor<string>
  tabs: Accessor<OpenTab[]>
  activeTab: Accessor<OpenTab | undefined>
  selectTab: (id: string) => void
  createTab: (input: Partial<OpenTab>) => string | undefined
  updateTab: (id: string, patch: Partial<OpenTab>) => void
  openFile: (id: string, target: OpenFileTarget) => Promise<void>
  navigate: (id: string, url: string) => Promise<string | undefined>
  capture: (id: string, expectedURL: string) => Promise<{ url: string; dataURL: string } | undefined> | undefined
  snapshot: (id: string) => Promise<{ url: string; title: string; bodyText: string; items: unknown[] } | undefined> | undefined
}) {
  const active = () => (input.enabled?.() ?? true) && input.activeTab()?.kind === "web" && input.activeTab()?.agentControlled === true

  createEffect(() => {
    if (input.enabled && !input.enabled()) return
    const sessionID = input.sessionID()
    if (!sessionID) return
    const unregister = registerSessionWorkspaceRequestHandler(sessionID, handle)
    onCleanup(unregister)
  })

  async function handle(request: SessionWorkspaceRequest, signal: AbortSignal): Promise<SessionWorkspaceResult> {
    if (request.operation === "workspace.open") return openWorkspacePath(request.input.path, signal)
    if (request.operation === "browser.navigate") return navigate(request.input.url, signal)
    if (request.operation === "browser.state") return { operation: request.operation, output: { url: currentURL() } }
    if (request.operation === "browser.screenshot") return screenshot(request.input.expectedURL, signal)
    return snapshot(request.input.expectedURL, signal)
  }

  async function openWorkspacePath(path: string, signal: AbortSignal): Promise<SessionWorkspaceResult> {
    const target = filePathFromInput(path, input.directory())
    if (!target) throw new Error("A workspace file path is required.")
    const identity = openTabFileIdentity({ path: target, directory: input.directory() })
    const existing = input.tabs().find((tab) => tab.kind === "file" && openTabFileIdentity(tab, input.directory()) === identity)
    const id = existing?.id ?? input.createTab({ input: target, title: compactPath(target), directory: input.directory() })
    if (!id) throw new Error("The session workspace has no clean inactive tab available.")
    input.selectTab(id)
    if (!existing?.content) await input.openFile(id, { path: target, directory: input.directory(), signal })
    requireActive(signal)
    const opened = input.tabs().find((tab) => tab.id === id)
    if (!opened?.content) throw new Error(opened?.message || `Could not open ${path}.`)
    return { operation: "workspace.open", output: { path } }
  }

  async function navigate(value: string, signal: AbortSignal): Promise<SessionWorkspaceResult> {
    requireActive(signal)
    const url = browserURL(value)
    const existing = agentTab()
    const id = existing?.id ?? input.createTab({ kind: "web", input: url, url, title: inputLabel(url), agentControlled: true })
    if (!id) throw new Error("The session workspace has no clean inactive tab available.")
    input.selectTab(id)
    input.updateTab(id, { kind: "web", input: url, url, title: inputLabel(url), message: "", agentControlled: true })
    const finalURL = await input.navigate(id, url)
    requireActive(signal)
    if (!finalURL) throw new Error(`Could not navigate to ${url}.`)
    return { operation: "browser.navigate", output: { url: finalURL } }
  }

  async function screenshot(expectedURL: string, signal: AbortSignal): Promise<SessionWorkspaceResult> {
    const tab = requireAgentTab(expectedURL)
    const capture = await input.capture(tab.id, expectedURL)
    requireActive(signal)
    if (!capture) throw new Error("Could not capture the permitted agent-controlled webpage.")
    return { operation: "browser.screenshot", output: capture }
  }

  async function snapshot(expectedURL: string, signal: AbortSignal): Promise<SessionWorkspaceResult> {
    const tab = requireAgentTab(expectedURL)
    const value = await input.snapshot(tab.id)
    requireActive(signal)
    if (!value) throw new Error("Could not read the agent-controlled webpage.")
    if (value.url !== expectedURL) throw new Error(`Browser URL changed from ${expectedURL} to ${value.url}.`)
    return { operation: "browser.snapshot", output: { url: expectedURL, text: JSON.stringify(value) } }
  }

  function requireAgentTab(expectedURL: string) {
    const tab = agentTab()
    const url = tab?.state?.url || null
    if (!tab || url !== expectedURL) throw new Error(`Browser URL does not match the permitted URL ${expectedURL}.`)
    return tab
  }

  function agentTab() {
    return input.tabs().find((tab) => tab.kind === "web" && tab.agentControlled)
  }

  function currentURL() {
    return agentTab()?.state?.url || ""
  }

  function requireActive(signal: AbortSignal) {
    if (signal.aborted) throw new Error("The session workspace operation was cancelled.")
  }

  return { active }
}

function browserURL(value: string) {
  const normalized = workbenchNormalizeBrowserURL(value)
  if (!URL.canParse(normalized)) throw new Error("A valid HTTP(S) URL is required.")
  const url = new URL(normalized)
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only HTTP(S) URLs can be opened.")
  return url.href
}
