import type { DiffFile, WorkbenchGitFileStatus } from "./store"
import type { WorkbenchDiffFile, WorkbenchPatchRow } from "./workbench"

export function normalizeWorkbenchDiffs(files: readonly DiffFile[]) {
  return files.flatMap((file): WorkbenchDiffFile[] => {
    const path = workbenchPathKey(file.file)
    if (!path) return []
    return [{
      file: path,
      patch: file.patch,
      additions: file.additions,
      deletions: file.deletions,
      status: file.status ?? "modified",
    }]
  })
}

export function workbenchGitChangeRows(statusFiles: readonly WorkbenchGitFileStatus[], diffFiles: readonly WorkbenchDiffFile[]) {
  const statusPaths = new Set(statusFiles.map((file) => workbenchPathKey(file.path)))
  return [
    ...statusFiles.map((file) => ({
      ...file,
      path: workbenchPathKey(file.path),
    })),
    ...diffFiles.flatMap((file): WorkbenchGitFileStatus[] => {
      const path = workbenchPathKey(file.file)
      if (!path || statusPaths.has(path)) return []
      return [{
        path,
        code: file.status === "added" ? "A " : file.status === "deleted" ? "D " : " M",
        status: file.status,
        staged: false,
        unstaged: true,
        untracked: file.status === "added" && file.patch?.includes("/dev/null") === true,
      }]
    }),
  ]
}

export function workbenchFilteredGitChangeRows(files: readonly WorkbenchGitFileStatus[], query: string) {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return [...files]
  if (normalized === "staged") return files.filter((file) => file.staged)
  if (normalized === "unstaged" || normalized === "changes") return files.filter((file) => file.unstaged || file.untracked || !file.staged)
  if (normalized === "new" || normalized === "untracked") return files.filter((file) => file.untracked || file.status === "added")
  return files.filter((file) => [
    file.path,
    file.status,
    file.code,
    file.staged ? "staged" : "changes",
    file.untracked ? "new" : "",
  ].some((value) => value.toLowerCase().includes(normalized)))
}

export function workbenchGitChangeGroups(files: readonly WorkbenchGitFileStatus[]) {
  return {
    staged: files.filter((file) => file.staged),
    unstaged: files.filter((file) => file.unstaged || file.untracked || !file.staged),
  }
}

export function workbenchGitFileStats(_file: Pick<WorkbenchGitFileStatus, "path">, diff: WorkbenchDiffFile | undefined) {
  return {
    additions: diff?.additions ?? 0,
    deletions: diff?.deletions ?? 0,
    total: (diff?.additions ?? 0) + (diff?.deletions ?? 0),
  }
}

export function workbenchGitSummary(files: readonly WorkbenchGitFileStatus[], diffs: readonly WorkbenchDiffFile[]) {
  const diffByPath = new Map(diffs.map((diff) => [workbenchPathKey(diff.file), diff]))
  const stats = files.map((file) => workbenchGitFileStats(file, diffByPath.get(workbenchPathKey(file.path))))
  return {
    changed: files.length,
    staged: files.filter((file) => file.staged).length,
    unstaged: files.filter((file) => file.unstaged || file.untracked || !file.staged).length,
    additions: stats.reduce((total, stat) => total + stat.additions, 0),
    deletions: stats.reduce((total, stat) => total + stat.deletions, 0),
  }
}

export function workbenchDiffForPath(files: readonly WorkbenchDiffFile[], path: string | undefined) {
  const key = workbenchPathKey(path)
  if (!key) return
  return files.find((file) => workbenchPathKey(file.file) === key)
    ?? files.find((file) => workbenchPathKey(file.file).endsWith(`/${key}`))
}

export function workbenchPatchRows(patch: string): WorkbenchPatchRow[] {
  const rows: WorkbenchPatchRow[] = []
  let oldLine = 0
  let newLine = 0
  let inHunk = false
  for (const line of patch.replace(/\r\n?/g, "\n").split("\n")) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
    if (hunk) {
      oldLine = Number(hunk[1])
      newLine = Number(hunk[2])
      inHunk = true
      rows.push({ kind: "hunk", text: line })
      continue
    }
    if (!inHunk || line.startsWith("\\ No newline")) {
      rows.push({ kind: "meta", text: line })
      continue
    }
    if (line.startsWith("+")) {
      rows.push({ kind: "addition", text: line.slice(1), newLine })
      newLine++
      continue
    }
    if (line.startsWith("-")) {
      rows.push({ kind: "deletion", text: line.slice(1), oldLine })
      oldLine++
      continue
    }
    const text = line.startsWith(" ") ? line.slice(1) : line
    rows.push({ kind: "context", text, oldLine, newLine })
    oldLine++
    newLine++
  }
  return rows.filter((row) => row.kind !== "meta" || row.text.trim())
}

function workbenchPathKey(value: string | undefined) {
  return value?.replaceAll("\\", "/").replace(/^\.\/+/, "").replaceAll("/./", "/") ?? ""
}
