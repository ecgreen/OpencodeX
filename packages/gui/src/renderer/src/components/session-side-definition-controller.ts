import { createEffect, createSignal, onCleanup, type Accessor } from "solid-js"
import type { GuiClient } from "../lib/client"
import {
  workbenchFileCompletion,
  workbenchFileDefinition,
  workbenchFileHover,
  type WorkbenchCompletionResult,
  type WorkbenchDefinitionLocation,
} from "../lib/store"
import { compactPath } from "../lib/format"
import { workbenchPathKey } from "../lib/workbench"
import { openTabFileIdentity } from "./session-side-open-state"
import type { OpenFileTarget, OpenTab } from "./session-side-open-types"

export function createSessionSideDefinitionController(input: {
  gui: Accessor<GuiClient | undefined>
  directory: Accessor<string>
  tabs: Accessor<OpenTab[]>
  activeTab: Accessor<OpenTab | undefined>
  selectTab: (id: string) => void
  createTab: (input: Partial<OpenTab>) => string | undefined
  updateTab: (id: string, patch: Partial<OpenTab>) => void
  openFile: (id: string, target: OpenFileTarget) => Promise<void>
  languageStatus?: (supported: boolean, message?: string) => void
}) {
  const [navigation, setNavigation] = createSignal<(WorkbenchDefinitionLocation & { token: number }) | undefined>()
  let controller: AbortController | undefined
  let token = 0

  createEffect(() => {
    input.directory()
    controller?.abort()
    token++
    setNavigation(undefined)
  })
  onCleanup(() => controller?.abort())

  async function open(position: { line: number; column: number }) {
    const gui = input.gui()
    const tab = input.activeTab()
    const directory = tab?.directory || input.directory()
    if (!gui || tab?.kind !== "file" || !tab.path || tab.content?.type !== "text" || !directory) return
    const origin = openTabFileIdentity(tab, input.directory())
    const request = ++token
    controller?.abort()
    const pending = new AbortController()
    controller = pending
    const locations = await workbenchFileDefinition(gui, {
      path: tab.path,
      root: tab.root,
      content: tab.text,
      line: position.line,
      column: position.column,
      signal: pending.signal,
    }, directory).catch(() => [])
    const current = input.activeTab()
    if (request !== token || pending.signal.aborted || current?.id !== tab.id || openTabFileIdentity(current, input.directory()) !== origin) return
    const location = locations[0]
    const target = workbenchPathKey(location?.path ?? "")
    if (!location || !target) return
    const targetTab = { path: target, directory, root: location.root, readOnly: location.readOnly }
    const identity = openTabFileIdentity(targetTab)
    const existing = input.tabs().find((item) => item.kind === "file" && openTabFileIdentity(item, input.directory()) === identity)
    if (existing) {
      input.updateTab(existing.id, { directory, root: location.root, readOnly: existing.readOnly || location.readOnly ? true : undefined })
      input.selectTab(existing.id)
    }
    if (!existing) {
      const id = input.createTab({ input: target, title: compactPath(target), ...targetTab })
      if (!id) return
      await input.openFile(id, { ...targetTab, signal: pending.signal })
      if (request !== token || pending.signal.aborted) return
    }
    const active = input.activeTab()
    if (active?.kind !== "file" || openTabFileIdentity(active, input.directory()) !== identity) return
    setNavigation({ ...location, path: target, token: request })
  }

  async function hover(position: { line: number; column: number }, signal?: AbortSignal) {
    const gui = input.gui()
    const tab = input.activeTab()
    const directory = tab?.directory || input.directory()
    if (!gui || tab?.kind !== "file" || !tab.path || tab.content?.type !== "text" || !directory) return
    const result = await workbenchFileHover(gui, {
      path: tab.path,
      root: tab.root,
      content: tab.text,
      line: position.line,
      column: position.column,
      signal,
    }, directory).catch((cause) => {
      if (!signal?.aborted) input.languageStatus?.(false, cause instanceof Error ? cause.message : "Language intelligence is unavailable.")
      return undefined
    })
    const current = input.activeTab()
    if (signal?.aborted || current?.id !== tab.id || openTabFileIdentity(current, input.directory()) !== openTabFileIdentity(tab, input.directory())) return
    if (result) input.languageStatus?.(result.supported, result.message)
    return result
  }

  async function completion(
    position: { line: number; column: number },
    context: { triggerKind: 1 | 2 | 3; triggerCharacter?: string },
    signal?: AbortSignal,
  ): Promise<WorkbenchCompletionResult | undefined> {
    const gui = input.gui()
    const tab = input.activeTab()
    const directory = tab?.directory || input.directory()
    if (!gui || tab?.kind !== "file" || !tab.path || tab.content?.type !== "text" || !directory || tab.readOnly) return
    const result = await workbenchFileCompletion(gui, {
      path: tab.path,
      root: tab.root,
      content: tab.text,
      line: position.line,
      column: position.column,
      ...context,
      signal,
    }, directory).catch((cause) => {
      if (!signal?.aborted) input.languageStatus?.(false, cause instanceof Error ? cause.message : "Language intelligence is unavailable.")
      return undefined
    })
    const current = input.activeTab()
    if (signal?.aborted || current?.id !== tab.id || openTabFileIdentity(current, input.directory()) !== openTabFileIdentity(tab, input.directory())) return
    if (result) input.languageStatus?.(result.supported, result.message)
    return result
  }

  return { open, hover, completion, navigation }
}
