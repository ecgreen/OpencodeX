import type { Session } from "@opencode-ai/sdk/v2/client"
import type { WorkbenchDiagnostic, WorkbenchGitStatus } from "../lib/store"
import { modelValue } from "../lib/model-selection"
import { workbenchPathKey, type WorkbenchDiffFile } from "../lib/workbench"

export function errorText(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback
}

export function newBrowserID() {
  return `workbench-${Math.random().toString(36).slice(2)}`
}

export function gitStatusSymbol(file: WorkbenchGitStatus["files"][number]) {
  if (file.status === "added") return "A"
  if (file.status === "deleted") return "D"
  return "M"
}

export function assistantSessionModel(session: Session | undefined) {
  if (!session?.model) return ""
  return modelValue(session.model.providerID, session.model.id)
}

export function workbenchDiffsEqual(left: WorkbenchDiffFile[], right: WorkbenchDiffFile[]) {
  if (left.length !== right.length) return false
  return left.every((item, index) => {
    const other = right[index]
    return other &&
      item.file === other.file &&
      item.patch === other.patch &&
      item.additions === other.additions &&
      item.deletions === other.deletions &&
      item.status === other.status
  })
}

export function diagnosticMatchesPath(diagnostic: WorkbenchDiagnostic, path: string) {
  const left = workbenchPathKey(diagnostic.path)
  const right = workbenchPathKey(path)
  if (!left || !right) return false
  return left === right || left.endsWith(`/${right}`) || right.endsWith(`/${left}`)
}
