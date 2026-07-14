import { createHash } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { app } from "electron"

export type SidecarLaunch = {
  command: string
  args: string[]
  cwd: string
  database?: string
  startupLog?: string
}

export type CoordinatorManifest = {
  version: 1
  key: string
  directory: string
  pid: number
  url: string
  username: string
  password: string
  token: string
  createdAt: string
}

type ProjectSummary = {
  id: string
  name?: string
  folders: string[]
  sessions: number
}

const DATA_ROOT = path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "opencode")
const COORDINATOR_ROOT = path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state"), "opencode", "tui-coordinators")

export const COORDINATOR_USERNAME = "opencodex-local"

export function normalizeDirectory(directory: string) {
  const resolved = path.resolve(directory)
  return process.platform === "win32" ? resolved.toLowerCase() : resolved
}

export function coordinatorKey(directory: string) {
  return createHash("sha1").update(normalizeDirectory(directory)).digest("hex")
}

export function coordinatorManifestPath(key: string) {
  return path.join(COORDINATOR_ROOT, `${key}.json`)
}

export function coordinatorStartupLogPath(key: string) {
  return path.join(COORDINATOR_ROOT, `${key}.startup.log`)
}

export function coordinatorClientDir(key: string) {
  return path.join(COORDINATOR_ROOT, `${key}.clients`)
}

export function coordinatorHeaders(manifest: Pick<CoordinatorManifest, "username" | "password">) {
  return {
    authorization: `Basic ${Buffer.from(`${manifest.username}:${manifest.password}`).toString("base64")}`,
  }
}

export function createSidecarLaunch(directory: string, key: string, database?: string): SidecarLaunch {
  if (app.isPackaged) {
    const binary = bundledBinary()
    if (!fs.existsSync(binary)) throw new Error(`Missing packaged OpencodeX sidecar binary: ${binary}`)
    return { command: binary, args: coordinatorArgs(directory, key), cwd: directory, database: process.env.OPENCODEX_GUI_DB }
  }

  if (process.env.OPENCODEX_GUI_SIDECAR) {
    return {
      command: process.env.OPENCODEX_GUI_SIDECAR,
      args: coordinatorArgs(directory, key),
      cwd: directory,
      database,
    }
  }

  const bun = findExecutable("bun") ?? findExecutable("bun.exe")
  if (!bun) throw new Error("Missing Bun for OpencodeX GUI dev sidecar. Install Bun or set OPENCODEX_GUI_SIDECAR.")
  return {
    command: bun,
    args: [
      "run",
      "--conditions=browser",
      path.join(opencodePackageDirectory(), "src", "index.ts"),
      ...coordinatorArgs(directory, key),
    ],
    cwd: opencodePackageDirectory(),
    database,
  }
}

export function workingDirectory() {
  if (process.env.OPENCODEX_GUI_DIRECTORY) return process.env.OPENCODEX_GUI_DIRECTORY
  if (!app.isPackaged) return developmentDefaultDirectory()
  return process.cwd()
}

export function selectedDatabaseEnv(database: string | undefined) {
  if (process.env.OPENCODE_DB) return {}
  if (!database) return {}
  return { OPENCODE_DB: database }
}

export function sidecarDatabase(directory: string) {
  if (process.env.OPENCODE_DB) return undefined
  if (process.env.OPENCODEX_GUI_DB) return process.env.OPENCODEX_GUI_DB
  if (app.isPackaged || process.env.OPENCODEX_GUI_SIDECAR) return undefined
  return selectDevelopmentDatabase(directory)
}

export async function coordinatorMatchesDatabase(manifest: CoordinatorManifest, database: string | undefined) {
  if (!database) return true
  const expected = projectSummaryFromDatabase(database)
  if (!expected) return true
  const actual = await projectSummaryFromCoordinator(manifest)
  if (!actual) return false
  return JSON.stringify(normalizeProjectSummary(actual)) === JSON.stringify(normalizeProjectSummary(expected))
}

export function startError(error: unknown, started: SidecarLaunch) {
  const message = error instanceof Error ? error.message : String(error)
  return new Error(
    `Failed to start OpencodeX sidecar with "${started.command} ${started.args.join(" ")}": ${message}${startupLogDetails(started)}`,
  )
}

export function startupLogDetails(started: SidecarLaunch) {
  if (!started.startupLog) return ""
  const tail = readStartupLogTail(started.startupLog)
  if (!tail) return `\nStartup log: ${started.startupLog}`
  return `\nStartup log: ${started.startupLog}\n${tail}`
}

export function createStartupLog(started: SidecarLaunch) {
  fs.mkdirSync(COORDINATOR_ROOT, { recursive: true })
  fs.writeFileSync(
    started.startupLog!,
    [
      `[${new Date().toISOString()}] starting OpencodeX coordinator`,
      `command: ${started.command}`,
      `args: ${started.args.join(" ")}`,
      `cwd: ${started.cwd}`,
      "",
    ].join("\n"),
  )
  return fs.openSync(started.startupLog!, "a")
}

function bundledBinary() {
  const executable = process.platform === "win32" ? "opencode.exe" : "opencode"
  return path.join(process.resourcesPath, "sidecar", executable)
}

function opencodePackageDirectory() {
  return path.resolve(app.getAppPath(), "..", "opencode")
}

function executableCandidates(command: string) {
  if (process.platform !== "win32" || path.extname(command)) return [command]
  return (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM")
    .split(";")
    .filter(Boolean)
    .map((extension) => `${command}${extension.toLowerCase()}`)
}

function findExecutable(command: string) {
  if (path.isAbsolute(command)) return fs.existsSync(command) ? command : undefined
  return (process.env.PATH ?? "")
    .split(path.delimiter)
    .filter(Boolean)
    .flatMap((entry) => executableCandidates(command).map((candidate) => path.join(entry, candidate)))
    .find((candidate) => fs.existsSync(candidate))
}

function coordinatorArgs(directory: string, key: string) {
  return ["internal-tui-coordinator", directory, "--key", key]
}

function developmentDefaultDirectory() {
  const guiPackage = app.getAppPath()
  const root = path.resolve(guiPackage, "..", "..")
  const initial = process.env.INIT_CWD
  if (initial && !isSameOrInside(guiPackage, initial)) return initial
  if (fs.existsSync(path.join(root, "package.json"))) return root
  return initial ?? process.cwd()
}

function isSameOrInside(parent: string, child: string) {
  const relative = path.relative(path.resolve(parent), path.resolve(child))
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

function selectDevelopmentDatabase(directory: string) {
  if (!fs.existsSync(DATA_ROOT)) return undefined
  const candidates = fs
    .readdirSync(DATA_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^opencode(?:-.+)?\.db$/.test(entry.name))
    .map((entry) => databaseCandidate(path.join(DATA_ROOT, entry.name), directory))
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

function projectSummaryFromDatabase(file: string) {
  try {
    const db = new DatabaseSync(file, { readOnly: true, open: true })
    try {
      return (
        db.prepare(`
          SELECT p.id, p.name, COUNT(DISTINCT s.session_id) AS sessions
          FROM opencodex_project p
          LEFT JOIN opencodex_project_session s ON s.opencodex_project_id = p.id
          GROUP BY p.id, p.name
          ORDER BY p.id
        `).all() as Array<{ id: string; name?: string | null; sessions: number }>
      ).map((project) => ({
        id: project.id,
        name: project.name ?? undefined,
        folders: (
          db.prepare("SELECT path FROM opencodex_project_folder WHERE opencodex_project_id = ? ORDER BY path").all(
            project.id,
          ) as Array<{ path: string }>
        ).map((folder) => path.resolve(folder.path)),
        sessions: Number(project.sessions ?? 0),
      }))
    } finally {
      db.close()
    }
  } catch {
    return undefined
  }
}

async function projectSummaryFromCoordinator(manifest: CoordinatorManifest) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 1_500)
  try {
    const response = await fetch(new URL("/experimental/opencodex/project", manifest.url), {
      headers: coordinatorHeaders(manifest),
      signal: controller.signal,
    })
    if (!response.ok) return undefined
    return ((await response.json()) as Array<{
      id: string
      name?: string
      folders?: Array<{ path: string }>
      sessions?: unknown[]
    }>).map((project) => ({
      id: project.id,
      name: project.name,
      folders: (project.folders ?? []).map((folder) => path.resolve(folder.path)).toSorted(),
      sessions: project.sessions?.length ?? 0,
    })).toSorted((a, b) => a.id.localeCompare(b.id))
  } catch {
    return undefined
  } finally {
    clearTimeout(timeout)
  }
}

function normalizeProjectSummary(projects: ProjectSummary[]) {
  return projects
    .map((project) => ({
      id: project.id,
      name: project.name,
      folders: project.folders.map((folder) => path.resolve(folder)).toSorted(),
      sessions: project.sessions,
    }))
    .toSorted((a, b) => a.id.localeCompare(b.id))
}

function databaseCandidate(file: string, directory: string) {
  try {
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

function readStartupLogTail(file: string) {
  try {
    const content = fs.readFileSync(file, "utf8").trim()
    if (!content) return undefined
    return content.length > 4_000 ? content.slice(-4_000) : content
  } catch {
    return undefined
  }
}
