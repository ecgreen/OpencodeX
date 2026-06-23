import type { Session } from "@opencode-ai/sdk/v2/client"
import { isRenderableClientSession, type ClientSessionSyncResult } from "@opencode-ai/sdk/v2/client-sync"
import type { GuiClient } from "./client"
import type { SessionCardSnapshot } from "./store-types"

export function isRenderableSession(session: Session) {
  return isRenderableClientSession(session)
}

export function sessionSyncSnapshot(result: ClientSessionSyncResult): SessionCardSnapshot {
  if (result.changed) return { ...result.snapshot, sessionSyncRevision: result.revision }
  return {
    projects: [],
    sessions: [],
    views: [],
    sessionStatus: {},
    sessionUiState: {},
    permissions: [],
    questions: [],
    sessionSyncRevision: result.revision,
  }
}

export async function sessionListQuery(gui: GuiClient): Promise<{ scope?: "project"; path?: string }> {
  if (!gui.directory) return { scope: "project" }
  const current = await gui.client.project.current({ directory: gui.directory }).then((x) => x.data).catch(() => undefined)
  const worktree = current?.worktree
  if (!worktree) return { scope: "project" }
  const relative = relativePath(worktree, gui.directory)
  if (relative === undefined) return { scope: "project" }
  return { path: relative }
}

function relativePath(root: string, target: string) {
  const normalizedRoot = normalizePath(root)
  const normalizedTarget = normalizePath(target)
  const insensitive = hasWindowsDrive(normalizedRoot) || hasWindowsDrive(normalizedTarget)
  const rootKey = insensitive ? normalizedRoot.toLowerCase() : normalizedRoot
  const targetKey = insensitive ? normalizedTarget.toLowerCase() : normalizedTarget
  if (rootKey === targetKey) return ""
  const prefix = normalizedRoot.endsWith("/") ? normalizedRoot : `${normalizedRoot}/`
  const prefixKey = insensitive ? prefix.toLowerCase() : prefix
  if (!targetKey.startsWith(prefixKey)) return undefined
  return normalizedTarget.slice(prefix.length)
}

function normalizePath(value: string) {
  return value.replaceAll("\\", "/").replace(/\/+$/, "")
}

function hasWindowsDrive(value: string) {
  return /^[a-zA-Z]:\//.test(value)
}
