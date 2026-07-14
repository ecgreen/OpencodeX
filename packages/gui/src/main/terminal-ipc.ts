import path from "node:path"
import { spawn, type IPty } from "@lydell/node-pty"
import { app, ipcMain, type WebContents } from "electron"
import { validString } from "./ipc-validation.js"

type TerminalProcess = {
  ownerID: number
  proc: IPty
  closed: boolean
}

type PtyWithErrorEvents = IPty & {
  on?: (eventName: "error", listener: (error: Error & { code?: string }) => void) => void
  _agent?: {
    inSocket?: {
      on?: (eventName: "error", listener: (error: Error & { code?: string }) => void) => void
    }
  }
}

const terminalProcesses = new Map<string, TerminalProcess>()
const terminalOwners = new Set<number>()

export function registerTerminalIpc() {
  ipcMain.handle("opencodex:terminal:create", (event, raw: unknown) => {
    const input = validTerminalCreateInput(raw)
    if (!input) return { ok: false, message: "Invalid terminal request." }
    const existing = terminalProcesses.get(input.id)
    if (existing) {
      return existing.ownerID === event.sender.id
        ? { ok: true, pid: existing.proc.pid }
        : { ok: false, message: "Terminal belongs to another renderer." }
    }
    const shell = terminalShell()
    const sender = event.sender
    const ownerID = sender.id
    try {
      const proc = spawn(shell.command, shell.args, {
        name: "xterm-256color",
        cols: input.cols,
        rows: input.rows,
        cwd: input.cwd || app.getPath("home"),
        env: terminalEnvironment(),
      })
      terminalProcesses.set(input.id, { ownerID, proc, closed: false })
      registerTerminalErrorHandler(input.id, proc)
      proc.onData((data) => sendTerminalEvent(sender, "opencodex:terminal:data", { id: input.id, data }))
      proc.onExit((exit) => {
        closeTerminal(input.id)
        sendTerminalEvent(sender, "opencodex:terminal:exit", {
          id: input.id,
          ...(typeof exit.exitCode === "number" ? { exitCode: exit.exitCode } : {}),
          ...(typeof exit.signal === "number" || typeof exit.signal === "string" ? { signal: exit.signal } : {}),
        })
      })
      registerTerminalOwner(sender)
      return { ok: true, pid: proc.pid }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "Failed to open terminal." }
    }
  })

  ipcMain.handle("opencodex:terminal:write", (event, raw: unknown) => {
    const input = validTerminalWriteInput(raw)
    if (!input) return false
    return writeTerminal(input.id, input.data, event.sender.id)
  })

  ipcMain.on("opencodex:terminal:write", (event, raw: unknown) => {
    const input = validTerminalWriteInput(raw)
    if (!input) return
    writeTerminal(input.id, input.data, event.sender.id)
  })

  ipcMain.handle("opencodex:terminal:resize", (event, raw: unknown) => {
    const input = validTerminalResizeInput(raw)
    if (!input) return false
    return resizeTerminal(input.id, input.cols, input.rows, event.sender.id)
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
  const input = value as { id?: unknown; cwd?: unknown; cols?: unknown; rows?: unknown }
  const id = validString(input.id)
  if (!id) return undefined
  const cwd = validString(input.cwd)?.trim()
  return {
    id,
    ...(cwd ? { cwd } : {}),
    cols: terminalDimension(input.cols, 100),
    rows: terminalDimension(input.rows, 30),
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

function terminalEnvironment() {
  return Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  )
}

function destroyTerminal(id: string, ownerID?: number) {
  const terminal = terminalProcesses.get(id)
  if (!terminal || (ownerID !== undefined && terminal.ownerID !== ownerID)) return false
  terminal.closed = true
  terminalProcesses.delete(id)
  try {
    terminal.proc.kill()
    return true
  } catch {
    return false
  }
}

function closeTerminal(id: string) {
  const terminal = terminalProcesses.get(id)
  if (!terminal) return
  terminal.closed = true
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
    closeTerminal(id)
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
    closeTerminal(id)
    return false
  }
}

function registerTerminalErrorHandler(id: string, proc: IPty) {
  const procWithErrors = proc as PtyWithErrorEvents
  procWithErrors.on?.("error", () => closeTerminal(id))
  procWithErrors._agent?.inSocket?.on?.("error", () => closeTerminal(id))
}
