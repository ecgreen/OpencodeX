import path from "node:path"
import type { IPty } from "@lydell/node-pty"
import { app, ipcMain, type WebContents } from "electron"
import { validString } from "./ipc-validation.js"
import { ownerHasResourceCapacity } from "./native-resource-limits.js"
import { createTerminalOutputBatcher } from "./terminal-output-batcher.js"

type TerminalProcess = {
  ownerID: number
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
  ipcMain.handle("opencodex:terminal:create", async (event, raw: unknown) => {
    const input = validTerminalCreateInput(raw)
    if (!input) return { ok: false, message: "Invalid terminal request." }
    const existing = terminalProcesses.get(input.id)
    if (existing) {
      return existing.ownerID === event.sender.id
        ? { ok: true, pid: existing.proc.pid }
        : { ok: false, message: "Terminal belongs to another renderer." }
    }
    if (!ownerHasResourceCapacity(terminalProcesses.values(), event.sender.id)) {
      return { ok: false, message: "This window already has the maximum of 8 terminals open." }
    }
    const shell = terminalShell()
    const sender = event.sender
    const ownerID = sender.id
    try {
      const { spawn } = await import("@lydell/node-pty")
      if (sender.isDestroyed()) return { ok: false, message: "Terminal renderer was closed." }
      const concurrent = terminalProcesses.get(input.id)
      if (concurrent) {
        return concurrent.ownerID === ownerID
          ? { ok: true, pid: concurrent.proc.pid }
          : { ok: false, message: "Terminal belongs to another renderer." }
      }
      if (!ownerHasResourceCapacity(terminalProcesses.values(), ownerID)) {
        return { ok: false, message: "This window already has the maximum of 8 terminals open." }
      }
      const proc = spawn(shell.command, shell.args, {
        name: "xterm-256color",
        cols: input.cols,
        rows: input.rows,
        cwd: input.cwd || app.getPath("home"),
        env: terminalEnvironment(),
      })
      const terminal: TerminalProcess = {
        ownerID,
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
      const disposeErrors = registerTerminalErrorHandler(proc, () => destroyTerminal(input.id, ownerID))
      terminal.disposeEvents = () => {
        disposeData.dispose()
        disposeExit.dispose()
        disposeErrors()
      }
      registerTerminalOwner(sender)
      return { ok: true, pid: proc.pid }
    } catch (error) {
      destroyTerminal(input.id, ownerID)
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

function registerTerminalErrorHandler(proc: IPty, close: () => void) {
  const procWithErrors = proc as PtyWithErrorEvents
  const listener = () => close()
  procWithErrors.on?.("error", listener)
  procWithErrors._agent?.inSocket?.on?.("error", listener)
  return () => {
    if (procWithErrors.off) procWithErrors.off("error", listener)
    else procWithErrors.removeListener?.("error", listener)
    if (procWithErrors._agent?.inSocket?.off) procWithErrors._agent.inSocket.off("error", listener)
    else procWithErrors._agent?.inSocket?.removeListener?.("error", listener)
  }
}
