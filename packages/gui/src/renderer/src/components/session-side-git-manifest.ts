import type { GuiClient } from "../lib/client"
import { workbenchChanges, type WorkbenchChangeFile, type WorkbenchChangesPage } from "../lib/session-api"

const PAGE_SIZE = 200
const PAGE_TIMEOUT_MS = 30_000

export async function loadWorkbenchManifest(input: {
  gui: GuiClient
  directory: string
  controller: AbortController
  current: () => boolean
  first?: (page: WorkbenchChangesPage) => void
  publish?: (page: WorkbenchChangesPage, files: WorkbenchChangeFile[]) => void
}) {
  const files: WorkbenchChangeFile[] = []
  const first = await page(input.controller, () => workbenchChanges(input.gui, {
    directory: input.directory, limit: PAGE_SIZE, metadata: false, signal: input.controller.signal,
  }))
  if (!first.ok) throw new Error(first.message ?? "Unable to load project changes.")
  if (!input.current()) return undefined
  files.push(...first.items)
  input.first?.(first)
  input.publish?.(first, files)
  let cursor = first.next
  while (cursor) {
    const next = await page(input.controller, () => workbenchChanges(input.gui, {
      directory: input.directory, cursor, revision: first.revision, limit: PAGE_SIZE, metadata: false, signal: input.controller.signal,
    }))
    if (!next.ok || next.revision !== first.revision) throw new Error(next.message ?? "The change snapshot became stale.")
    if (!input.current()) return undefined
    files.push(...next.items)
    input.publish?.(first, files)
    cursor = next.next
  }
  return input.current() ? { first, files } : undefined
}

async function page<T>(controller: AbortController, load: () => Promise<T>) {
  let timedOut = false
  const timer = globalThis.setTimeout(() => {
    timedOut = true
    controller.abort()
  }, PAGE_TIMEOUT_MS)
  try {
    const result = await load()
    if (timedOut) throw new Error("Loading project changes timed out. Retry when the workspace is less busy.")
    return result
  } catch (cause) {
    if (timedOut) throw new Error("Loading project changes timed out. Retry when the workspace is less busy.", { cause })
    throw cause
  } finally {
    globalThis.clearTimeout(timer)
  }
}
