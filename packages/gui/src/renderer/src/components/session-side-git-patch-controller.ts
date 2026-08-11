import { createMemo, createSignal, type Accessor } from "solid-js"
import type { GuiClient } from "../lib/client"
import { workbenchChangePatchPage } from "../lib/session-api"
import { emptyWorkbenchPatch, isWorkbenchAbort, workbenchPatchForPath, workbenchPatchKey, type WorkbenchPatchModel } from "./session-side-git-model"

export function createWorkbenchPatchController(input: {
  gui: Accessor<GuiClient | undefined>
  directory: Accessor<string>
  revision: Accessor<string>
  measure: (path: string, revision: string) => void
  refresh: () => void
  applyMetrics: (path: string, additions: number, deletions: number, binary: boolean) => void
}) {
  const [entries, setEntries] = createSignal<readonly (readonly [string, WorkbenchPatchModel])[]>([])
  const [loading, setLoading] = createSignal("")
  const patches = createMemo(() => new Map(entries()))
  let request: AbortController | undefined

  async function load(path: string) {
    const gui = input.gui()
    const directory = input.directory()
    const revision = input.revision()
    const key = workbenchPatchKey(revision, path)
    if (!gui || !directory || !revision || patches().get(key)?.complete || loading() === path) return
    input.measure(path, revision)
    request?.abort()
    const controller = new AbortController()
    request = controller
    setLoading(path)
    try {
      let cursor: string | undefined
      let model = patches().get(key) ?? emptyWorkbenchPatch(path, revision)
      do {
        const page = await workbenchChangePatchPage(gui, { directory, path, revision, cursor, context: 8, signal: controller.signal })
        if (controller.signal.aborted || revision !== input.revision() || directory !== input.directory()) return
        if (!page.ok) {
          model = { ...model, ...page, pages: model.pages, complete: true }
          setEntries([[key, model]])
          if (page.stale) input.refresh()
          return
        }
        model = { ...model, ...page, pages: page.patch ? [...model.pages, page.patch] : model.pages }
        setEntries([[key, model]])
        cursor = page.next
      } while (cursor)
      if (model.additions !== undefined && model.deletions !== undefined) input.applyMetrics(path, model.additions, model.deletions, model.binary)
    } catch (cause) {
      if (isWorkbenchAbort(cause)) return
      setEntries([[key, {
        ...emptyWorkbenchPatch(path, revision),
        message: cause instanceof Error ? cause.message : "Unable to load file patch.",
        complete: true,
      }]])
    } finally {
      if (request === controller) request = undefined
      if (loading() === path) setLoading("")
    }
  }

  function abort() {
    request?.abort()
    request = undefined
    setLoading("")
  }

  return {
    loading,
    load,
    abort,
    reset: () => { abort(); setEntries([]) },
    patch: (path: string) => workbenchPatchForPath(entries(), input.revision(), path),
  }
}
