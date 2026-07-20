import { batch, type Accessor, type Setter } from "solid-js"
import type { GuiClient } from "../lib/client"
import { workbenchChangeMetricsPage, type WorkbenchChangeFile } from "../lib/store"
import { displayWorkbenchChangeSummary, isWorkbenchAbort, mergeWorkbenchFileMetrics, type WorkbenchChangeSummary } from "./session-side-git-model"

export function createSelectedWorkbenchMetricsController(input: {
  gui: Accessor<GuiClient | undefined>
  directory: Accessor<string>
  revision: Accessor<string>
  files: Accessor<readonly WorkbenchChangeFile[]>
  setFiles: Setter<readonly WorkbenchChangeFile[]>
  setSummary: Setter<WorkbenchChangeSummary>
  setError: Setter<string>
  refresh: () => void
}) {
  let request: AbortController | undefined

  async function measure(path: string, currentRevision: string) {
    const gui = input.gui()
    const directory = input.directory()
    const file = input.files().find((item) => item.path === path)
    if (!gui || !directory || !file || file.binary !== undefined || file.additions !== undefined && file.deletions !== undefined) return
    request?.abort()
    const controller = new AbortController()
    request = controller
    try {
      const page = await workbenchChangeMetricsPage(gui, {
        directory,
        revision: currentRevision,
        path,
        limit: 1,
        signal: controller.signal,
      })
      if (controller.signal.aborted || currentRevision !== input.revision() || directory !== input.directory()) return
      if (!page.ok) {
        if (page.stale) input.refresh()
        return
      }
      if (!page.items.some((item) => item.path === path)) return
      const files = mergeWorkbenchFileMetrics(input.files(), page.items)
      batch(() => {
        input.setFiles(files)
        input.setSummary(displayWorkbenchChangeSummary(page.summary, files))
        input.setError("")
      })
    } catch (cause) {
      if (!isWorkbenchAbort(cause) && currentRevision === input.revision())
        input.setError(cause instanceof Error ? cause.message : "Line metrics are paused.")
    } finally {
      if (request === controller) request = undefined
    }
  }

  function abort() {
    request?.abort()
    request = undefined
  }

  return { measure, abort }
}
