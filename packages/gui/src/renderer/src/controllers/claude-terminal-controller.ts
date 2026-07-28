import type { OpencodeXTerminalSession } from "@opencode-ai/sdk/v2/client"
import { createSignal, onCleanup, type Accessor } from "solid-js"
import { createStore } from "solid-js/store"
import { terminalSurface } from "../components/session-side-terminal-views"
import type { GuiClient } from "../lib/client"
import { claudeStatusLabel, exitDescription } from "../lib/terminal-presentation"

/** Catalog ids for terminal sessions; the one place the prefix is spelled out. */
export function isTerminalSessionRecordID(id: string) {
  return id.startsWith("oxts_")
}

/**
 * Where a Claude Code record opens: the native session page once its headless
 * driver has mirrored a session, and the raw terminal page otherwise (which is
 * also the sign-in and debugging surface).
 */
export function terminalSessionRoute(record: { id: string; sessionID?: string } | undefined, fallbackID: string) {
  if (record?.sessionID) return { name: "session", sessionID: record.sessionID } as const
  return { name: "terminal-session", terminalSessionID: record?.id ?? fallbackID } as const
}

export type ClaudeTerminalRuntimeStatus =
  | "idle"
  | "starting"
  | "running"
  | "stopped"
  | "missing-cli"
  | "wrong-device"
  | "error"

export type ClaudeTerminalRuntime = {
  status: ClaudeTerminalRuntimeStatus
  code?: string
  message?: string
  pid?: number
  exitCode?: number
  signal?: number | string
}

const idleRuntime: ClaudeTerminalRuntime = { status: "idle" }

export function createClaudeTerminalController(input: {
  client: Accessor<GuiClient | undefined>
  refresh: () => Promise<void>
}) {
  const [runtimes, setRuntimes] = createStore<Record<string, ClaudeTerminalRuntime>>({})
  const [localInstallationID, setLocalInstallationID] = createSignal<string>()
  const startTokens = new Map<string, number>()
  // Swallow IPC rejections here: `start` treats a missing id as desktop-required
  // instead of leaving an unhandled rejection and a UI stuck on "starting".
  const installation = window.opencodex?.installationID()
    .then((id) => {
      setLocalInstallationID(id)
      return id
    })
    .catch(() => undefined)

  /**
   * Transitions replace the whole record. A merge would carry `code`, `message`,
   * or `exitCode` from a previous failure into the next healthy state - the
   * stale `desktop-required` code would even hide the Resume button for good.
   * Writing every key keeps Solid's per-key equality, so the per-chunk
   * "running" write from onData still doesn't re-render anything.
   */
  function setRuntime(id: string, next: ClaudeTerminalRuntime) {
    setRuntimes(id, {
      status: next.status,
      code: next.code,
      message: next.message,
      pid: next.pid,
      exitCode: next.exitCode,
      signal: next.signal,
    })
  }

  const terminal = window.opencodex?.terminal
  // A short tail of recent output per session, kept so exit handling can
  // recognize the CLI's own failure explanations (see disposeExit).
  const outputTails = new Map<string, string>()
  const startAttempts = new Map<string, { record: OpencodeXTerminalSession; mode: "new" | "resume"; retriedFresh: boolean }>()
  const disposeData = terminal?.onData((event) => {
    if (!event.id.startsWith("terminal-session:")) return
    try {
      terminalSurface.ensure(event.id, write, openURL, true).terminal.write(event.data)
      terminalSurface.markOpen(event.id)
      const id = catalogID(event.id)
      if (!id) return
      outputTails.set(id, `${outputTails.get(id) ?? ""}${event.data}`.slice(-2_000))
      setRuntime(id, { status: "running", pid: runtimes[id]?.pid })
    } catch (error) {
      const id = catalogID(event.id)
      if (id) setRuntime(id, runtimeError("resource-limit", error))
    }
  })
  const disposeExit = terminal?.onExit((event) => {
    if (!event.id.startsWith("terminal-session:")) return
    terminalSurface.markClosed(event.id)
    const id = catalogID(event.id)
    if (!id) return
    if (event.exitCode === 0 && event.signal === undefined && !event.message) {
      setRuntime(id, { status: "stopped", exitCode: 0 })
      return
    }
    // The record flips to resume mode on first spawn, but Claude only persists
    // a conversation after real use - abandon the launch during sign-in and
    // every later `--resume` fails with "No conversation found". That id is
    // provably unused, so retry once as a fresh conversation with the same id.
    const attempt = startAttempts.get(id)
    if (
      attempt &&
      attempt.mode === "resume" &&
      !attempt.retriedFresh &&
      /no conversation found/i.test(outputTails.get(id) ?? "")
    ) {
      attempt.retriedFresh = true
      void start(attempt.record, { freshConversation: true })
      return
    }
    setRuntime(id, {
      status: "error",
      code: "process-exit",
      message: event.message ?? `Claude Code exited${exitDescription(event)}.`,
      exitCode: event.exitCode,
      signal: event.signal,
    })
  })

  async function start(record: OpencodeXTerminalSession, options: { freshConversation?: boolean } = {}) {
    try {
      return await startUnguarded(record, options)
    } catch (error) {
      setRuntime(record.id, runtimeError("error", error))
      return false
    }
  }

  async function startUnguarded(record: OpencodeXTerminalSession, options: { freshConversation?: boolean }) {
    const token = nextStartToken(record.id)
    const installationID = window.opencodex?.terminal && window.opencodex.claude && installation ? await installation : undefined
    if (!installationID) {
      setRuntime(record.id, {
        status: "error",
        code: "desktop-required",
        message: "Requires OpencodeX Desktop.",
      })
      return false
    }
    if (record.installationID !== installationID) {
      setRuntime(record.id, {
        status: "wrong-device",
        code: "wrong-device",
        message: "Available on another device.",
      })
      return false
    }
    setRuntime(record.id, { status: "starting" })
    let view: ReturnType<typeof terminalSurface.ensure>
    try {
      view = terminalSurface.ensure(terminalID(record.id), write, openURL, true)
    } catch (error) {
      setRuntime(record.id, runtimeError("resource-limit", error))
      return false
    }
    // Let the surface's pending fit run so the PTY spawns at the real pane
    // size instead of a fixed grid that immediately resizes (a full TUI redraw).
    await new Promise((resolve) => setTimeout(resolve))
    if (startTokens.get(record.id) !== token) return false
    const attached = view.terminal.element?.isConnected === true
    const mode = options.freshConversation || record.timeLaunched === undefined ? "new" : "resume"
    // One fresh-conversation fallback per user-initiated start.
    startAttempts.set(record.id, { record, mode, retriedFresh: options.freshConversation === true })
    outputTails.delete(record.id)
    const result = await window.opencodex!.terminal!.create({
      id: terminalID(record.id),
      cwd: record.directory,
      cols: attached ? view.terminal.cols : 100,
      rows: attached ? view.terminal.rows : 30,
      profile: {
        kind: "claude-code",
        mode,
        resumeID: record.resumeID,
        installationID: record.installationID,
      },
    })
    if (startTokens.get(record.id) !== token) {
      if (result.ok) await window.opencodex!.terminal!.destroy(terminalID(record.id)).catch(() => false)
      return false
    }
    if (!result.ok) {
      setRuntime(record.id, {
        status:
          result.code === "missing-cli"
            ? "missing-cli"
            : result.code === "wrong-device"
              ? "wrong-device"
              : "error",
        code: result.code,
        message: result.message ?? "Failed to open Claude Code.",
      })
      return false
    }
    terminalSurface.markOpen(terminalID(record.id))
    setRuntime(record.id, { status: "running", pid: result.pid })
    const client = input.client()
    if (client) {
      await client.client.opencodex.terminalSession
        .opened({ terminalSessionID: record.id }, { throwOnError: true })
        .then(() => input.refresh())
        .catch((error) => {
          setRuntime(record.id, {
            status: "running",
            pid: result.pid,
            message: error instanceof Error ? error.message : "Could not record the Claude Code launch.",
          })
        })
    }
    return true
  }

  async function stop(record: OpencodeXTerminalSession) {
    nextStartToken(record.id)
    const destroyed = await window.opencodex?.terminal?.destroy(terminalID(record.id))
    terminalSurface.markClosed(terminalID(record.id))
    // Free the xterm slot too: stopped sessions must not count against the
    // shared terminal budget, or the ninth session in an app run can never open.
    terminalSurface.dispose(terminalID(record.id))
    setRuntime(record.id, { status: "stopped" })
    return destroyed ?? false
  }

  function attach(record: OpencodeXTerminalSession, host: HTMLElement, focus = true) {
    try {
      return terminalSurface.attach(terminalID(record.id), host, write, openURL, true, focus)
    } catch (error) {
      setRuntime(record.id, runtimeError("resource-limit", error))
      return () => undefined
    }
  }

  function focus(record: OpencodeXTerminalSession) {
    terminalSurface.focus(terminalID(record.id))
  }

  async function checkCLI() {
    if (!window.opencodex?.claude) return { available: false, message: "Requires OpencodeX Desktop." }
    return await window.opencodex.claude.status()
  }

  function runtime(record: OpencodeXTerminalSession) {
    if (!window.opencodex?.terminal) {
      return { status: "error", code: "desktop-required", message: "Requires OpencodeX Desktop." } as const
    }
    if (localInstallationID() && record.installationID !== localInstallationID()) {
      return { status: "wrong-device", code: "wrong-device", message: "Available on another device." } as const
    }
    return runtimes[record.id] ?? idleRuntime
  }

  function statusLabel(record: OpencodeXTerminalSession) {
    return claudeStatusLabel(runtime(record))
  }

  function write(id: string, data: string) {
    window.opencodex?.terminal?.write({ id, data })
  }

  function openURL(url: string) {
    void window.opencodex?.browser?.external(url)
  }

  function nextStartToken(id: string) {
    const token = (startTokens.get(id) ?? 0) + 1
    startTokens.set(id, token)
    return token
  }

  onCleanup(() => {
    disposeData?.()
    disposeExit?.()
    startTokens.clear()
    startAttempts.clear()
    outputTails.clear()
  })

  return { attach, checkCLI, focus, installationID: localInstallationID, runtime, start, statusLabel, stop }
}

function terminalID(id: string) {
  return `terminal-session:${id}`
}

function catalogID(id: string) {
  return id.startsWith("terminal-session:") ? id.slice("terminal-session:".length) : undefined
}

function runtimeError(code: string, error: unknown): ClaudeTerminalRuntime {
  return { status: "error", code, message: error instanceof Error ? error.message : String(error) }
}
