export type WorkbenchGitRunResult = {
  code: number
  text: string
  stderr: Buffer
}

export type WorkbenchGitDiffFile = {
  file: string
  patch: string
  additions: number
  deletions: number
  status: "added" | "deleted" | "modified"
}

export type WorkbenchGitHistoryFile = {
  path: string
  status: string
  previousPath?: string
}

export type WorkbenchGitHistoryCommit = {
  hash: string
  shortHash: string
  author: string
  email?: string
  date: string
  subject: string
  body?: string
  files: WorkbenchGitHistoryFile[]
}

export function parseWorkbenchGitDiffs(text: string): WorkbenchGitDiffFile[] {
  return splitGitDiff(text).flatMap((patch) => {
    const file = workbenchGitPatchFile(patch)
    if (!file) return []
    const stats = workbenchGitPatchStats(patch)
    return [{
      file,
      patch,
      additions: stats.additions,
      deletions: stats.deletions,
      status: patch.includes("--- /dev/null")
        ? "added"
        : patch.includes("+++ /dev/null")
          ? "deleted"
          : "modified",
    }]
  })
}

export function parseWorkbenchGitHistory(text: string): WorkbenchGitHistoryCommit[] {
  return text.split("\x1e").flatMap((chunk) => {
    const lines = chunk.replace(/^\r?\n/, "").split(/\r?\n/)
    const header = lines[0]?.split("\x1f") ?? []
    if (header.length < 6 || !header[0]) return []
    const fileStart = lines.findIndex((line, index) => index > 0 && /^[A-Z][A-Z0-9]*\t/.test(line))
    const bodyLines = fileStart === -1 ? lines.slice(1) : lines.slice(1, fileStart)
    const fileLines = fileStart === -1 ? [] : lines.slice(fileStart)
    const body = [header.slice(6).join("\x1f"), ...bodyLines].join("\n").trim()
    return [{
      hash: header[0],
      shortHash: header[1] ?? header[0].slice(0, 7),
      author: header[2] ?? "",
      ...(header[3] ? { email: header[3] } : {}),
      date: header[4] ?? "",
      subject: header[5] ?? "",
      ...(body ? { body } : {}),
      files: fileLines.flatMap(parseWorkbenchGitHistoryFile),
    }]
  })
}

export function mergeWorkbenchGitDiffs(lists: Array<WorkbenchGitDiffFile[]>) {
  const items = new Map<string, WorkbenchGitDiffFile>()
  lists.flat().forEach((item) => {
    const current = items.get(item.file)
    if (!current) {
      items.set(item.file, item)
      return
    }
    items.set(item.file, {
      ...current,
      patch: [current.patch, item.patch].filter(Boolean).join("\n"),
      additions: current.additions + item.additions,
      deletions: current.deletions + item.deletions,
      status: current.status === item.status ? current.status : "modified",
    })
  })
  return [...items.values()].sort((left, right) => left.file.localeCompare(right.file))
}

export async function workbenchGitDiffFiles(
  cwd: string,
  gitRun: (args: string[], cwd: string) => Promise<WorkbenchGitRunResult>,
) {
  const [unstaged, staged, untracked] = await Promise.all([
    gitRun(["diff", "--relative", "--no-ext-diff", "--unified=8", "--", "."], cwd),
    gitRun(["diff", "--cached", "--relative", "--no-ext-diff", "--unified=8", "--", "."], cwd),
    gitRun(["ls-files", "--others", "--exclude-standard", "-z", "--", "."], cwd),
  ])
  if (unstaged.code !== 0) return { ok: false, message: gitMessage(unstaged) || "Unable to load unstaged diffs.", data: [] }
  if (staged.code !== 0) return { ok: false, message: gitMessage(staged) || "Unable to load staged diffs.", data: [] }
  if (untracked.code !== 0) return { ok: false, message: gitMessage(untracked) || "Unable to list untracked files.", data: [] }
  const untrackedPatches = await Promise.all(
    untracked.text.split("\0").filter(Boolean).map((file) => gitRun(["diff", "--no-ext-diff", "--no-index", "--unified=8", "--", "/dev/null", file], cwd)),
  )
  return {
    ok: true,
    data: mergeWorkbenchGitDiffs([
      parseWorkbenchGitDiffs(staged.text),
      parseWorkbenchGitDiffs(unstaged.text),
      ...untrackedPatches.map((patch) => parseWorkbenchGitDiffs(patch.text)),
    ]),
  }
}

export async function workbenchGitHistory(
  cwd: string,
  gitRun: (args: string[], cwd: string) => Promise<WorkbenchGitRunResult>,
) {
  const result = await gitRun([
    "log",
    "--date=iso-strict",
    "--pretty=format:%x1e%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%b",
    "--name-status",
    "-n",
    "100",
    "--",
    ".",
  ], cwd)
  if (result.code !== 0) return { ok: false, message: gitMessage(result) || "Unable to load Git history.", data: [] }
  return { ok: true, data: parseWorkbenchGitHistory(result.text) }
}

function splitGitDiff(text: string) {
  const starts = [...text.matchAll(/(?:^|\n)diff --git /g)].map((match) =>
    match[0].startsWith("\n") ? match.index + 1 : match.index,
  )
  return starts.map((start, index) => text.slice(start, starts[index + 1] ?? text.length).trim()).filter(Boolean)
}

function parseWorkbenchGitHistoryFile(line: string): WorkbenchGitHistoryFile[] {
  const parts = line.split("\t").filter(Boolean)
  const status = parts[0]
  if (!status) return []
  if (status.startsWith("R") || status.startsWith("C")) {
    const previousPath = parts[1]
    const path = parts[2]
    if (!path) return []
    return [{ status, path, ...(previousPath ? { previousPath } : {}) }]
  }
  const path = parts[1]
  if (!path) return []
  return [{ status, path }]
}

function workbenchGitPatchFile(patch: string) {
  const file = /^\+\+\+ (.+)$/m.exec(patch)?.[1] ?? /^--- (.+)$/m.exec(patch)?.[1]
  if (!file || file === "/dev/null") return
  return file.replace(/^"?(?:a|b)\//, "").replace(/"$/, "")
}

function workbenchGitPatchStats(patch: string) {
  const lines = patch.split(/\r?\n/)
  return {
    additions: lines.filter((line) => line.startsWith("+") && !line.startsWith("+++")).length,
    deletions: lines.filter((line) => line.startsWith("-") && !line.startsWith("---")).length,
  }
}

function gitMessage(result: WorkbenchGitRunResult) {
  return result.stderr.toString("utf8").trim() || result.text.trim()
}
