import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const DATA_ROOT = path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "opencode")

export async function selectDevelopmentDatabase(directory: string) {
  if (!fs.existsSync(DATA_ROOT)) return undefined
  const candidates = (
    await Promise.all(
      fs
        .readdirSync(DATA_ROOT, { withFileTypes: true })
        .filter((entry) => entry.isFile() && /^opencode(?:-.+)?\.db$/.test(entry.name))
        .map((entry) => databaseCandidate(path.join(DATA_ROOT, entry.name), directory)),
    )
  )
    .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
    .toSorted((a, b) =>
      b.matchingSessions - a.matchingSessions ||
      Number(b.name !== "opencode-local.db") - Number(a.name !== "opencode-local.db") ||
      b.matchingProjects - a.matchingProjects ||
      b.projects - a.projects ||
      b.updated - a.updated,
    )
  return candidates[0]?.path
}

async function databaseCandidate(file: string, directory: string) {
  try {
    const { DatabaseSync } = await import("node:sqlite")
    const db = new DatabaseSync(file, { readOnly: true, open: true })
    try {
      const folders = db
        .prepare(`
          SELECT f.path, COUNT(s.session_id) AS sessions
          FROM opencodex_project_folder f
          LEFT JOIN opencodex_project_session s ON s.opencodex_project_id = f.opencodex_project_id
          GROUP BY f.opencodex_project_id, f.path
        `)
        .all() as Array<{ path: string; sessions: number }>
      const matches = folders.filter((folder) => containsPath(folder.path, directory))
      if (matches.length === 0) return undefined
      return {
        path: file,
        name: path.basename(file),
        matchingProjects: matches.length,
        matchingSessions: matches.reduce((sum, folder) => sum + Number(folder.sessions ?? 0), 0),
        projects: Number((db.prepare("SELECT COUNT(*) AS count FROM opencodex_project").get() as { count: number }).count ?? 0),
        updated: fs.statSync(file).mtimeMs,
      }
    } finally {
      db.close()
    }
  } catch {
    return undefined
  }
}

function containsPath(parent: string, child: string) {
  const relative = path.relative(path.resolve(parent), path.resolve(child))
  if (relative === "") return true
  return !relative.startsWith("..") && !path.isAbsolute(relative)
}
