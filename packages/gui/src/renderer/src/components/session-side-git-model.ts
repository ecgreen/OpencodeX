import type { WorkbenchChangeFile, WorkbenchChangesPage } from "../lib/session-api"
import { sidePanelPathKey } from "./session-side-path"

export type WorkbenchChangeSummary = WorkbenchChangesPage["summary"]

export type WorkbenchPatchModel = {
  ok: boolean
  stale: boolean
  path: string
  revision: string
  status: WorkbenchChangeFile["status"]
  pages: readonly string[]
  additions?: number
  deletions?: number
  binary: boolean
  complete: boolean
  message?: string
}

export function reconcileWorkbenchFiles(
  current: readonly WorkbenchChangeFile[],
  incoming: readonly WorkbenchChangeFile[],
) {
  const existing = new Map(current.map((file) => [file.path, file]))
  return incoming.map((file) => {
    const previous = existing.get(file.path)
    if (!previous || previous.status !== file.status || previous.staged !== file.staged
      || previous.unstaged !== file.unstaged || previous.untracked !== file.untracked || previous.openable !== file.openable) return file
    Object.assign(previous, file)
    return previous
  })
}

export function mergeWorkbenchFileMetrics(
  files: readonly WorkbenchChangeFile[],
  metrics: readonly { path: string; additions: number; deletions: number; binary: boolean }[],
) {
  const byPath = new Map(metrics.map((metric) => [metric.path, metric]))
  return files.map((file) => {
    const metric = byPath.get(file.path)
    if (!metric || file.additions === metric.additions && file.deletions === metric.deletions && file.binary === metric.binary) return file
    return { ...file, ...metric }
  })
}

export function sidePanelChangeForPath(files: readonly WorkbenchChangeFile[], path: string) {
  const key = sidePanelPathKey(path)
  return files.find((file) => sidePanelPathKey(file.path) === key)
    ?? files.find((file) => {
      const fileKey = sidePanelPathKey(file.path)
      return key.endsWith(`/${fileKey}`) || fileKey.endsWith(`/${key}`)
    })
}

export function displayWorkbenchChangeSummary(
  summary: WorkbenchChangeSummary,
  files: readonly WorkbenchChangeFile[],
): WorkbenchChangeSummary {
  const totals = files.reduce((value, file) => ({
    additions: value.additions + (file.binary ? 0 : file.additions ?? 0),
    deletions: value.deletions + (file.binary ? 0 : file.deletions ?? 0),
  }), { additions: 0, deletions: 0 })
  return { ...summary, ...totals }
}

export function emptyWorkbenchChangeSummary(): WorkbenchChangeSummary {
  return { fileCount: 0, additions: 0, deletions: 0, metricsResolved: 0, metricsTotal: 0, metricsComplete: true }
}

export function emptyWorkbenchPatch(path: string, revision: string): WorkbenchPatchModel {
  return { ok: true, stale: false, path, revision, status: "modified", pages: [], binary: false, complete: false }
}

export function workbenchPatchKey(revision: string, path: string) {
  return `${revision}\n${sidePanelPathKey(path)}`
}

export function workbenchPatchForPath(
  entries: readonly (readonly [string, WorkbenchPatchModel])[],
  revision: string,
  path: string,
) {
  return new Map(entries).get(workbenchPatchKey(revision, path))
    ?? entries.findLast(([, patch]) => sidePanelPathKey(patch.path) === sidePanelPathKey(path))?.[1]
}

export function normalizeWorkbenchDirectory(value: string) {
  return normalizeWorkbenchPath(value).toLocaleLowerCase()
}

export function normalizeWorkbenchPath(value: string) {
  return value.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "")
}

export function isWorkbenchAbort(cause: unknown) {
  return cause instanceof DOMException && cause.name === "AbortError"
    || cause instanceof Error && cause.name === "AbortError"
}
