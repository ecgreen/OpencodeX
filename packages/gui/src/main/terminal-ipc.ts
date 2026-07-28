import path from "node:path"
import { stat } from "node:fs/promises"
import type { IPty } from "@lydell/node-pty"
import { app, ipcMain, type WebContents } from "electron"
import { CLAUDE_MISSING_MESSAGE, type ClaudeCodeStatus, type TerminalCreateInput, type TerminalLaunchProfile, type TerminalResult } from "../shared/terminal.js"
import { claudeArguments, probeClaudeCode, resolveClaudeExecutable } from "./claude-code.js"
import { installationID, isUUID } from "./installation-id.js"
import { validString } from "./ipc-validation.js"
import { ownerHasResourceCapacity } from "./native-resource-limits.js"
import { createTerminalOutputBatcher } from "./terminal-output-batcher.js"

type TerminalProcess = {
  ownerID: number
  profileKind: TerminalLaunchProfile["kind"]
  proc: IPty
  closed: boolean
  output: ReturnType<typeof createTerminalOutputBatcher>
  disposeEvents: () => void
}

type PtyWithErrorEvents = IPty & {
  on?: (eventName: "error", listener: (error: Error & { code?: string }) => void) => void
  off?: (eventName: "error", listener: (error: Error & { code?: string }) => void) => void
  removeListener?: (eventName: "error", listener: (error: Error & { code?: string }) => void) => void
  _agent?: {
    inSocket?: {
      on?: (eventName: "error", listener: (error: Error & { code?: string }) => void) => void
      off?: (eventName: "error", listener: (error: Error & { code?: string }) => void) => void
      removeListener?: (eventName: "error", listener: (error: Error & { code?: string }) => void) => void
    }
  }
}

const terminalProcesses = new Map<string, TerminalProcess>()
const terminalOwners = new Set<number>()

export function registerTerminalIpc() {
  ipcMain.handle("opencodex:installation-id", () => installationID())
  ipcMain.handle("opencodex:claude:status", () => claudeStatus())

  ipcMain.handle("opencodex:terminal:create", async (event, raw: unknown): Promise<TerminalResult> => {
    const input = validTerminalCreateInput(raw)
    if (!input) return failure("invalid-request", "Invalid terminal request.")
    const existing = terminalProcesses.get(input.id)
    if (existing) {
      return duplicateResult(existing, event.sender.id, input.profile.kind)
    }
    if (!ownerHasResourceCapacity(terminalProcesses.values(), event.sender.id)) {
      return failure("resource-limit", "This window already has the maximum of 8 terminals open.")
    }
    const sender = event.sender
    const ownerID = sender.id
    try {
      const launch = await terminalLaunch(input)
      if (!("command" in launch)) return launch
      const { spawn } = await import("@lydell/node-pty")
      if (sender.isDestroyed()) return failure("error", "Terminal renderer was closed.")
      const concurrent = terminalProcesses.get(input.id)
      if (concurrent) {
        return duplicateResult(concurrent, ownerID, input.profile.kind)
      }
      if (!ownerHasResourceCapacity(terminalProcesses.values(), ownerID)) {
        return failure("resource-limit", "This window already has the maximum of 8 terminals open.")
      }
      const proc = spawn(launch.command, launch.args, {
        name: "xterm-256color",
        cols: input.cols,
        rows: input.rows,
        cwd: launch.cwd,
        env: terminalEnvironment(),
      })
      const terminal: TerminalProcess = {
        ownerID,
        profileKind: input.profile.kind,
        proc,
        closed: false,
        output: createTerminalOutputBatcher({
          emit: (data) => sendTerminalEvent(sender, "opencodex:terminal:data", { id: input.id, data }),
        }),
        disposeEvents: () => undefined,
      }
      terminalProcesses.set(input.id, terminal)
      const disposeData = proc.onData(terminal.output.push)
      const disposeExit = proc.onExit((exit) => {
        if (terminalProcesses.get(input.id) !== terminal) return
        terminal.output.close(true)
        closeTerminal(input.id, proc)
        sendTerminalEvent(sender, "opencodex:terminal:exit", {
          id: input.id,
          ...(typeof exit.exitCode === "number" ? { exitCode: exit.exitCode } : {}),
          ...(typeof exit.signal === "number" || typeof exit.signal === "string" ? { signal: exit.signal } : {}),
        })
      })
      // disposeEvents must be complete before the error handler can fire, or a
      // synchronous pty error would tear down with the placeholder and leak
      // the data/exit listeners.
      terminal.disposeEvents = () => {
        disposeData.dispose()
        disposeExit.dispose()
      }
      const disposeErrors = registerTerminalErrorHandler(proc, (error) => {
        sendTerminalEvent(sender, "opencodex:terminal:exit", { id: input.id, message: "The terminal process failed." })
        console.error("terminal process error", input.id, error)
        destroyTerminal(input.id, ownerID)
      })
      terminal.disposeEvents = () => {
        disposeData.dispose()
        disposeExit.dispose()
        disposeErrors()
      }
      registerTerminalOwner(sender)
      return { ok: true, pid: proc.pid }
    } catch (error) {
      destroyTerminal(input.id, ownerID)
      console.error("terminal create failed", input.id, error)
      return failure("error", "Failed to open the terminal. See the application log for details.")
    }
  })

  // The preload sends these two, so only the `on` registrations are reachable.
  ipcMain.on("opencodex:terminal:write", (event, raw: unknown) => {
    const input = validTerminalWriteInput(raw)
    if (!input) return
    writeTerminal(input.id, input.data, event.sender.id)
  })

  ipcMain.on("opencodex:terminal:resize", (event, raw: unknown) => {
    const input = validTerminalResizeInput(raw)
    if (!input) return
    resizeTerminal(input.id, input.cols, input.rows, event.sender.id)
  })

  ipcMain.handle("opencodex:terminal:destroy", (event, id: unknown) => {
    const terminalID = validString(id)
    return terminalID ? destroyTerminal(terminalID, event.sender.id) : false
  })
}

/**
 * An id may be re-used only by the same window AND the same profile kind. A
 * shell terminal answering for a claude-code id would bypass every claude
 * launch guard while looking like a success to the renderer.
 */
function duplicateResult(existing: TerminalProcess, senderID: number, profileKind: TerminalLaunchProfile["kind"]): TerminalResult {
  if (existing.ownerID !== senderID) return failure("duplicate-window", "Already open in another OpencodeX window.")
  if (existing.profileKind !== profileKind) return failure("invalid-request", "This terminal id is already in use by a different profile.")
  return { ok: true, pid: existing.proc.pid }
}

let claudeStatusCache: { value: Promise<ClaudeCodeStatus>; at: number } | undefined

/** The probe stats every PATH entry and spawns `claude --version`; cache it. */
function claudeStatus() {
  if (claudeStatusCache && Date.now() - claudeStatusCache.at < 5_000) return claudeStatusCache.value
  const value = probeClaudeCode(app.getPath("home"))
  claudeStatusCache = { value, at: Date.now() }
  value.catch(() => {
    claudeStatusCache = undefined
  })
  return value
}

function registerTerminalOwner(sender: WebContents) {
  if (terminalOwners.has(sender.id)) return
  terminalOwners.add(sender.id)
  sender.once("destroyed", () => {
    terminalProcesses.forEach((terminal, id) => {
      if (terminal.ownerID === sender.id) destroyTerminal(id)
    })
    terminalOwners.delete(sender.id)
  })
}

function validTerminalCreateInput(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const input = value as { id?: unknown; cwd?: unknown; cols?: unknown; rows?: unknown; profile?: unknown }
  const id = validString(input.id)
  if (!id) return undefined
  const cwd = validString(input.cwd)?.trim()
  const profile = validTerminalLaunchProfile(input.profile)
  if (input.profile !== undefined && !profile) return undefined
  return {
    id,
    ...(cwd ? { cwd } : {}),
    cols: terminalDimension(input.cols, 100),
    rows: terminalDimension(input.rows, 30),
    profile: profile ?? { kind: "shell" as const },
  }
}

function validTerminalLaunchProfile(value: unknown): TerminalLaunchProfile | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const profile = value as {
    kind?: unknown
    mode?: unknown
    resumeID?: unknown
    name?: unknown
    installationID?: unknown
  }
  if (profile.kind === "shell") return { kind: "shell" }
  if (profile.kind !== "claude-code" || (profile.mode !== "new" && profile.mode !== "resume")) return undefined
  const resumeID = validString(profile.resumeID)?.trim()
  const installation = validString(profile.installationID)?.trim()
  const name = validString(profile.name)?.trim()
  if (!resumeID || !installation || (profile.name !== undefined && name === undefined)) return undefined
  return {
    kind: "claude-code",
    mode: profile.mode,
    resumeID,
    installationID: installation,
    ...(name ? { name: name.slice(0, 200) } : {}),
  }
}

function validTerminalWriteInput(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const input = value as { id?: unknown; data?: unknown }
  const id = validString(input.id)
  const data = validString(input.data)
  if (!id || data === undefined) return undefined
  return { id, data }
}

function validTerminalResizeInput(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const input = value as { id?: unknown; cols?: unknown; rows?: unknown }
  const id = validString(input.id)
  if (!id) return undefined
  return { id, cols: terminalDimension(input.cols, 100), rows: terminalDimension(input.rows, 30) }
}

function terminalDimension(value: unknown, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback
  return Math.max(2, Math.min(400, Math.round(value)))
}

function terminalShell() {
  if (process.platform === "win32") {
    const command = process.env.OPENCODEX_TERMINAL_SHELL || "powershell.exe"
    const shellName = path.basename(command).toLowerCase()
    const isPowerShell = shellName === "powershell.exe" || shellName === "powershell" || shellName === "pwsh.exe" || shellName === "pwsh"
    return { command, args: isPowerShell ? ["-NoLogo", "-NoProfile", "-NoExit"] : [] }
  }
  return { command: process.env.SHELL || "/bin/sh", args: [] as string[] }
}

async function terminalLaunch(input: TerminalCreateInput & { profile: TerminalLaunchProfile }) {
  if (input.profile.kind === "shell") {
    const shell = terminalShell()
    return { ...shell, cwd: input.cwd || app.getPath("home") }
  }
  if (!/^terminal-session:oxts_[a-z0-9]+$/i.test(input.id) || !isUUID(input.profile.resumeID)) {
    return failure("invalid-request", "Invalid Claude Code terminal identity.")
  }
  if (!isUUID(input.profile.installationID) || input.profile.installationID.toLowerCase() !== (await installationID())) {
    return failure("wrong-device", "Available on another device.")
  }
  if (!input.cwd || !path.isAbsolute(input.cwd)) {
    return failure("invalid-directory", "The original working directory is unavailable.")
  }
  const directory = await stat(input.cwd).catch(() => undefined)
  if (!directory?.isDirectory()) {
    return failure("invalid-directory", "The original working directory is unavailable.")
  }
  const command = await resolveClaudeExecutable({ home: app.getPath("home") })
  if (!command) {
    return failure("missing-cli", CLAUDE_MISSING_MESSAGE)
  }
  return { command, args: claudeArguments(input.profile), cwd: input.cwd }
}

function failure(code: NonNullable<TerminalResult["code"]>, message: string): TerminalResult {
  return { ok: false, code, message }
}

function terminalEnvironment() {
  return Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  )
}

function destroyTerminal(id: string, ownerID?: number) {
  const terminal = terminalProcesses.get(id)
  if (!terminal || (ownerID !== undefined && terminal.ownerID !== ownerID)) return false
  terminal.closed = true
  terminal.output.close(false)
  terminal.disposeEvents()
  terminalProcesses.delete(id)
  try {
    terminal.proc.kill()
    return true
  } catch {
    return false
  }
}

function closeTerminal(id: string, proc?: IPty) {
  const terminal = terminalProcesses.get(id)
  if (!terminal || (proc && terminal.proc !== proc)) return
  terminal.closed = true
  terminal.output.close(false)
  terminal.disposeEvents()
  terminalProcesses.delete(id)
}

function sendTerminalEvent(sender: WebContents, channel: "opencodex:terminal:data" | "opencodex:terminal:exit", payload: object) {
  if (sender.isDestroyed()) return
  sender.send(channel, payload)
}

function writeTerminal(id: string, data: string, ownerID: number) {
  const terminal = terminalProcesses.get(id)
  if (!terminal || terminal.closed || terminal.ownerID !== ownerID) return false
  try {
    terminal.proc.write(data)
    return true
  } catch {
    destroyTerminal(id, ownerID)
    return false
  }
}

function resizeTerminal(id: string, cols: number, rows: number, ownerID: number) {
  const terminal = terminalProcesses.get(id)
  if (!terminal || terminal.closed || terminal.ownerID !== ownerID) return false
  try {
    terminal.proc.resize(cols, rows)
    return true
  } catch {
    destroyTerminal(id, ownerID)
    return false
  }
}

function registerTerminalErrorHandler(proc: IPty, close: (error: Error) => void) {
  const procWithErrors = proc as PtyWithErrorEvents
  const listener = (error: Error) => close(error)
  procWithErrors.on?.("error", listener)
  procWithErrors._agent?.inSocket?.on?.("error", listener)
  return () => {
    if (procWithErrors.off) procWithErrors.off("error", listener)
    else procWithErrors.removeListener?.("error", listener)
    if (procWithErrors._agent?.inSocket?.off) procWithErrors._agent.inSocket.off("error", listener)
    else procWithErrors._agent?.inSocket?.removeListener?.("error", listener)
  }
}
