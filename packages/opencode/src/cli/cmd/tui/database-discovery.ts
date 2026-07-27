import { Global } from "@opencode-ai/core/global"
import { Database } from "bun:sqlite"
import fs from "fs/promises"
import path from "path"

export async function discoverBackendDatabase(root = Global.Path.data) {
  const candidates = await Promise.all(
    (await fs.readdir(root, { withFileTypes: true }).catch(() => []))
      .filter((entry) => entry.isFile() && /^opencode(?:-.+)?\.db$/.test(entry.name))
      .map((entry) => databaseCandidate(path.join(root, entry.name))),
  )
  return candidates
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== undefined)
    .toSorted((a, b) => b.sessions - a.sessions || b.projects - a.projects || b.updated - a.updated)[0]?.path
}

async function databaseCandidate(file: string) {
  try {
    const database = new Database(file, { readonly: true })
    try {
      const projects = Number((database.query("SELECT COUNT(*) AS count FROM opencodex_project").get() as { count: number }).count)
      const sessions = Number((database.query("SELECT COUNT(*) AS count FROM session").get() as { count: number }).count)
      if (projects === 0 && sessions === 0) return undefined
      return { path: file, projects, sessions, updated: (await fs.stat(file)).mtimeMs }
    } finally {
      database.close()
    }
  } catch {
    return undefined
  }
}
