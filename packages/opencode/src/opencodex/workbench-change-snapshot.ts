import { Semaphore } from "effect"

export type WorkbenchChangeMode = "git" | "directory"

export type WorkbenchChangeFile = {
  type: "file"
  name: string
  path: string
  status: "added" | "deleted" | "modified"
  staged: boolean
  unstaged: boolean
  untracked: boolean
  openable: boolean
  additions?: number
  deletions?: number
  binary?: boolean
}

export type WorkbenchChangeSummary = {
  fileCount: number
  additions: number
  deletions: number
  metricsResolved: number
  metricsTotal: number
  metricsComplete: boolean
}

export type WorkbenchRepositoryMetadata = {
  branch?: string
  defaultBranch?: string
  upstream?: string
  ahead?: number
  behind?: number
  remoteUrl?: string
  githubUrl?: string
}

export type WorkbenchPatchCache = {
  status: WorkbenchChangeFile["status"]
  patch?: string
  pages: string[]
  additions: number
  deletions: number
  binary: boolean
  message?: string
}

export type WorkbenchChangeSnapshot = {
  directory: string
  revision: string
  createdAt: number
  mode: WorkbenchChangeMode
  baseline?: string
  files: WorkbenchChangeFile[]
  repository: WorkbenchRepositoryMetadata
  message?: string
  patches: Map<string, WorkbenchPatchCache>
}

const SNAPSHOT_TTL_MS = 2 * 60_000
const snapshots = new Map<string, WorkbenchChangeSnapshot[]>()
const snapshotLocks = new Map<string, { semaphore: Semaphore.Semaphore; users: number }>()

export function rememberWorkbenchSnapshot(snapshot: WorkbenchChangeSnapshot) {
  pruneWorkbenchSnapshots()
  snapshots.set(snapshot.directory, [
    snapshot,
    ...(snapshots.get(snapshot.directory) ?? []).filter((item) => item.revision !== snapshot.revision),
  ].slice(0, 2))
  return snapshot
}

export function findWorkbenchSnapshot(directory: string, revision: string) {
  pruneWorkbenchSnapshots()
  return snapshots.get(directory)?.find((snapshot) => snapshot.revision === revision)
}

export function latestWorkbenchSnapshot(directory: string) {
  pruneWorkbenchSnapshots()
  return snapshots.get(directory)?.[0]
}

export function acquireWorkbenchSnapshotLock(directory: string) {
  const lock = snapshotLocks.get(directory) ?? { semaphore: Semaphore.makeUnsafe(1), users: 0 }
  lock.users++
  snapshotLocks.set(directory, lock)
  return {
    semaphore: lock.semaphore,
    release: () => {
      lock.users--
      if (lock.users === 0 && !snapshots.has(directory) && snapshotLocks.get(directory) === lock) snapshotLocks.delete(directory)
    },
  }
}

export function workbenchChangeSummary(snapshot: WorkbenchChangeSnapshot): WorkbenchChangeSummary {
  return snapshot.files.reduce<WorkbenchChangeSummary>((summary, file) => {
    const resolved = file.binary !== undefined || file.additions !== undefined && file.deletions !== undefined
    return {
      ...summary,
      additions: summary.additions + (file.binary ? 0 : file.additions ?? 0),
      deletions: summary.deletions + (file.binary ? 0 : file.deletions ?? 0),
      metricsResolved: summary.metricsResolved + Number(resolved),
      metricsComplete: summary.metricsComplete && resolved,
    }
  }, {
    fileCount: snapshot.files.length,
    additions: 0,
    deletions: 0,
    metricsResolved: 0,
    metricsTotal: snapshot.files.length,
    metricsComplete: true,
  })
}

export function encodeWorkbenchCursor(value: { revision: string; path?: string; index: number }) {
  return Buffer.from(JSON.stringify(value)).toString("base64url")
}

export function decodeWorkbenchCursor(value: string | undefined) {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as {
      revision?: unknown
      path?: unknown
      index?: unknown
    }
    if (typeof parsed.revision !== "string" || typeof parsed.index !== "number") return undefined
    if (parsed.path !== undefined && typeof parsed.path !== "string") return undefined
    return { revision: parsed.revision, path: parsed.path, index: parsed.index }
  } catch {
    return undefined
  }
}

function pruneWorkbenchSnapshots() {
  const cutoff = Date.now() - SNAPSHOT_TTL_MS
  snapshots.forEach((items, directory) => {
    const current = items.filter((snapshot) => snapshot.createdAt >= cutoff).slice(0, 2)
    if (current.length > 0) snapshots.set(directory, current)
    else {
      snapshots.delete(directory)
      if (snapshotLocks.get(directory)?.users === 0) snapshotLocks.delete(directory)
    }
  })
}
