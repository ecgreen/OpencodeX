import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { app } from "electron"
import {
  COORDINATOR_LOCAL_VERSION,
  coordinatorClientDir as coordinatorClientDirIn,
  coordinatorDatabaseIdentity as coordinatorDatabaseIdentityOf,
  coordinatorHeaders as coordinatorHeadersFor,
  coordinatorKey as coordinatorKeyOf,
  coordinatorManifestPath as coordinatorManifestPathIn,
  coordinatorRoot,
  coordinatorStartupLogPath as coordinatorStartupLogPathIn,
  type CoordinatorCredentials,
  type CoordinatorManifest,
} from "@opencode-ai/sdk/coordinator"

export type SidecarLaunch = {
  command: string
  args: string[]
  cwd: string
  database: string
  startupLog?: string
}

export type { CoordinatorManifest }

const DATA_ROOT = path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "opencode")
/* Electron main cannot import the backend's Global paths, so the XDG state root
   is recomputed here. It must keep matching `Global.Path.state`, or the GUI and
   the TUI would look for each other's coordinators in different directories. */
const STATE_ROOT = path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state"), "opencode")
const COORDINATOR_ROOT = coordinatorRoot(STATE_ROOT)

export const COORDINATOR_USERNAME = "opencodex-local"
export const COORDINATOR_STATE_ROOT = STATE_ROOT

export function normalizeDirectory(directory: string) {
  const resolved = path.resolve(directory)
  return process.platform === "win32" ? resolved.toLowerCase() : resolved
}

/** A bare database name here means "in the GUI's data root", not the cwd. */
export function coordinatorDatabaseIdentity(database: string) {
  return coordinatorDatabaseIdentityOf(database, DATA_ROOT)
}

export function coordinatorKey(database: string) {
  return coordinatorKeyOf(database, DATA_ROOT)
}

export function coordinatorManifestPath(key: string) {
  return coordinatorManifestPathIn(STATE_ROOT, key)
}

export function coordinatorStartupLogPath(key: string) {
  return coordinatorStartupLogPathIn(STATE_ROOT, key)
}

export function coordinatorClientDir(key: string) {
  return coordinatorClientDirIn(STATE_ROOT, key)
}

export function coordinatorHeaders(manifest: CoordinatorCredentials) {
  return coordinatorHeadersFor(manifest)
}

/**
 * Version of the backend this GUI ships, used as the client half of the
 * coordinator handshake. A dev build spawns the coordinator with `bun run` over
 * the worktree, which is exactly the `"local"` case the policy allows through
 * with a warning; a packaged build reads the stamp `copy-sidecar.ts` wrote next
 * to the binary.
 */
export function sidecarVersion(): string {
  if (!app.isPackaged) return COORDINATOR_LOCAL_VERSION
  try {
    const stamp: unknown = JSON.parse(
      fs.readFileSync(path.join(process.resourcesPath, "sidecar", "version.json"), "utf8"),
    )
    const version = stampedVersion(stamp)
    if (version) return version
  } catch {
    // Fall through to the unverified case below.
  }
  /* Packaging should always produce the stamp. Without it the bundled server
     version is genuinely unknown, so degrade to the same "unverified" path a
     dev build takes rather than refusing to attach to anything. */
  console.warn("Missing packaged sidecar version stamp; coordinator version handshake will not be enforced")
  return COORDINATOR_LOCAL_VERSION
}

function stampedVersion(stamp: unknown) {
  if (typeof stamp !== "object" || stamp === null || !("version" in stamp)) return undefined
  return typeof stamp.version === "string" && stamp.version.length > 0 ? stamp.version : undefined
}

export function createSidecarLaunch(directory: string, key: string, database: string): SidecarLaunch {
  if (app.isPackaged) {
    const binary = bundledBinary()
    if (!fs.existsSync(binary)) throw new Error(`Missing packaged OpencodeX sidecar binary: ${binary}`)
    return { command: binary, args: coordinatorArgs(directory, key), cwd: directory, database }
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
      path.join(opencodePackageDirectory(), "src", "gui-coordinator.ts"),
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

export async function sidecarDatabase(directory: string) {
  const configured = process.env.OPENCODE_DB ?? process.env.OPENCODEX_GUI_DB
  if (configured) return coordinatorDatabaseIdentity(configured)
  if (
    app.isPackaged ||
    process.env.OPENCODE_DISABLE_CHANNEL_DB === "1" ||
    process.env.OPENCODE_DISABLE_CHANNEL_DB === "true"
  ) {
    return coordinatorDatabaseIdentity(path.join(DATA_ROOT, "opencode.db"))
  }
  if (!process.env.OPENCODEX_GUI_SIDECAR) {
    const selected = await (await import("./sidecar-development.js")).selectDevelopmentDatabase(directory)
    if (selected) return coordinatorDatabaseIdentity(selected)
  }
  return coordinatorDatabaseIdentity(path.join(DATA_ROOT, "opencode-local.db"))
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
  if (!started.startupLog) throw new Error("Missing coordinator startup log path")
  fs.mkdirSync(COORDINATOR_ROOT, { recursive: true })
  fs.writeFileSync(
    started.startupLog,
    [
      `[${new Date().toISOString()}] starting OpencodeX coordinator`,
      `command: ${started.command}`,
      `args: ${started.args.join(" ")}`,
      `cwd: ${started.cwd}`,
      "",
    ].join("\n"),
  )
  return fs.openSync(started.startupLog, "a")
}

function bundledBinary() {
  const executable = process.platform === "win32" ? "opencode-gui-coordinator.exe" : "opencode-gui-coordinator"
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
  return [directory, "--key", key]
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

function readStartupLogTail(file: string) {
  try {
    const content = fs.readFileSync(file, "utf8").trim()
    if (!content) return undefined
    return content.length > 4_000 ? content.slice(-4_000) : content
  } catch {
    return undefined
  }
}
