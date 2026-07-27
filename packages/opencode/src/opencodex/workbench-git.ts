export type WorkbenchGitRunResult = {
  code: number
  text: string
  stderr: Buffer
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

function gitMessage(result: WorkbenchGitRunResult) {
  return result.stderr.toString("utf8").trim() || result.text.trim()
}
