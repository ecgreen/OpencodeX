import { FitAddon } from "@xterm/addon-fit"
import { Terminal } from "@xterm/xterm"
import "@xterm/xterm/css/xterm.css"
import { createEffect, onCleanup, type Accessor } from "solid-js"
import { compactPath } from "../lib/format"
import { Icon } from "./icon"
import type { OpenTab } from "./session-side-open-types"

type TerminalTab = {
  id: string
  directory?: string
  terminalStatus?: "connecting" | "open" | "closed" | "error"
}

type TerminalView = {
  terminal: Terminal
  fit: FitAddon
  disposeInput: () => void
  resizeObserver?: ResizeObserver
}

const views = new Map<string, TerminalView>()
const openIDs = new Set<string>()
const restartTimers = new Map<string, number>()
let detachedDock: HTMLDivElement | undefined

export function SessionOpenTerminal(props: { tab: TerminalTab; write: (id: string, data: string) => void }) {
  let host: HTMLDivElement | undefined

  createEffect(() => {
    const id = props.tab.id
    if (!host) return
    const detach = attach(id, host, props.write)
    onCleanup(detach)
  })

  createEffect(() => {
    props.tab.terminalStatus
    queueMicrotask(() => fit(props.tab.id))
  })

  return (
    <div class="session-open-terminal">
      <header>
        <span><Icon name="terminal" /> {props.tab.directory ? compactPath(props.tab.directory) : "Terminal"}</span>
        <small>{props.tab.terminalStatus === "closed" ? "closed" : props.tab.terminalStatus === "connecting" ? "connecting" : "interactive"}</small>
      </header>
      <div class="session-open-terminal-host" ref={(element) => { host = element }} />
    </div>
  )
}

export function createSessionSideTerminalController(input: {
  active: Accessor<boolean>
  tabs: Accessor<OpenTab[]>
  activeTab: Accessor<OpenTab | undefined>
  directory: Accessor<string>
  createTab: (input: Partial<OpenTab>) => string
  updateTab: (id: string, patch: Partial<OpenTab>) => void
  closeMenu: () => void
}) {
  createEffect(() => {
    const terminal = window.opencodex?.terminal
    if (!terminal) return
    const disposeData = terminal.onData((event) => {
      const tab = input.tabs().find((tab) => tab.id === event.id)
      if (tab?.kind !== "terminal") return
      sessionTerminal.cancelRestart(event.id)
      sessionTerminal.ensure(event.id, write).terminal.write(event.data)
      if (sessionTerminal.isOpen(event.id)) return
      sessionTerminal.markOpen(event.id)
      input.updateTab(event.id, { terminalStatus: "open" })
    })
    const disposeExit = terminal.onExit((event) => {
      const tab = input.tabs().find((tab) => tab.id === event.id)
      if (tab?.kind !== "terminal") return
      sessionTerminal.markClosed(event.id)
      sessionTerminal.cancelRestart(event.id)
      const shouldRestart = sessionTerminal.exitShouldRestart(event)
      sessionTerminal.ensure(event.id, write).terminal.writeln(
        shouldRestart
          ? `\r\n[terminal process exited${sessionTerminal.exitDescription(event)}; restarting...]`
          : `\r\n[process exited${sessionTerminal.exitDescription(event)}]`,
      )
      input.updateTab(event.id, { terminalStatus: shouldRestart ? "connecting" : "closed" })
      if (shouldRestart) scheduleRestart(event.id)
    })
    onCleanup(() => {
      disposeData()
      disposeExit()
    })
  })

  createEffect(() => {
    const tab = input.activeTab()
    if (!input.active() || tab?.kind !== "terminal") return
    queueMicrotask(() => sessionTerminal.focus(tab.id))
  })

  function create() {
    const id = input.createTab({
      kind: "terminal",
      title: "Terminal",
      directory: input.directory(),
      terminalStatus: "connecting",
      text: "",
    })
    sessionTerminal.markClosed(id)
    sessionTerminal.ensure(id, write)
    input.closeMenu()
    void start(id)
  }

  function close(tab: OpenTab) {
    if (tab.kind !== "terminal") return
    sessionTerminal.cancelRestart(tab.id)
    sessionTerminal.dispose(tab.id)
    void window.opencodex?.terminal?.destroy(tab.id)
  }

  async function start(id: string) {
    if (!window.opencodex?.terminal) {
      sessionTerminal.ensure(id, write).terminal.writeln("Open terminal needs the latest desktop bridge. Restart OpencodeX and try again.")
      input.updateTab(id, { terminalStatus: "error" })
      return
    }
    const tab = input.tabs().find((tab) => tab.id === id)
    const result = await window.opencodex.terminal.create({ id, cwd: tab?.directory || input.directory(), cols: 100, rows: 30 })
    if (!result.ok) {
      sessionTerminal.ensure(id, write).terminal.writeln(result.message ?? "Failed to open terminal.")
      input.updateTab(id, { terminalStatus: "error" })
      return
    }
    sessionTerminal.fit(id)
  }

  function scheduleRestart(id: string) {
    sessionTerminal.scheduleRestart(id, () => {
      const tab = input.tabs().find((tab) => tab.id === id)
      if (tab?.kind === "terminal" && tab.terminalStatus === "connecting") void start(id)
    })
  }

  function write(id: string, data: string) {
    void window.opencodex?.terminal?.write({ id, data })
  }

  return { create, close, write }
}

export const sessionTerminal = {
  cancelRestart,
  dispose,
  ensure,
  exitDescription,
  exitShouldRestart,
  fit,
  focus(id: string) {
    fit(id)
    views.get(id)?.terminal.focus()
  },
  isOpen(id: string) {
    return openIDs.has(id)
  },
  markClosed(id: string) {
    openIDs.delete(id)
  },
  markOpen(id: string) {
    openIDs.add(id)
  },
  scheduleRestart(id: string, restart: () => void) {
    cancelRestart(id)
    restartTimers.set(id, window.setTimeout(() => {
      restartTimers.delete(id)
      restart()
    }, 250))
  },
}

function cancelRestart(id: string) {
  const timer = restartTimers.get(id)
  if (timer === undefined) return
  window.clearTimeout(timer)
  restartTimers.delete(id)
}

function exitDescription(event: { exitCode?: number; signal?: number | string }) {
  if (typeof event.exitCode === "number") return ` with code ${event.exitCode}`
  if (event.signal !== undefined) return ` from signal ${event.signal}`
  return ""
}

function exitShouldRestart(event: { exitCode?: number; signal?: number | string }) {
  return event.exitCode === undefined || event.exitCode !== 0 || event.signal !== undefined
}

function ensure(id: string, write: (id: string, data: string) => void) {
  const existing = views.get(id)
  if (existing) return existing
  const terminal = new Terminal({
    cursorBlink: true,
    customGlyphs: true,
    letterSpacing: 0,
    scrollback: 10_000,
    fontFamily: '"Cascadia Mono", "Cascadia Code", "JetBrains Mono", "SFMono-Regular", Menlo, Consolas, monospace',
    fontSize: 13,
    lineHeight: 1,
    theme: {
      background: "#05070a", foreground: "#d6deeb", cursor: "#67e8f9", selectionBackground: "#264f78",
      black: "#1f2937", red: "#f87171", green: "#34d399", yellow: "#fbbf24", blue: "#60a5fa",
      magenta: "#c084fc", cyan: "#22d3ee", white: "#e5e7eb", brightBlack: "#6b7280", brightRed: "#fb7185",
      brightGreen: "#4ade80", brightYellow: "#fde047", brightBlue: "#93c5fd", brightMagenta: "#d8b4fe",
      brightCyan: "#67e8f9", brightWhite: "#f8fafc",
    },
  })
  const fitAddon = new FitAddon()
  terminal.loadAddon(fitAddon)
  const input = terminal.onData((data) => write(id, data))
  const resize = terminal.onResize((size) => {
    void window.opencodex?.terminal?.resize({ id, cols: size.cols, rows: size.rows })
  })
  const view: TerminalView = {
    terminal,
    fit: fitAddon,
    disposeInput: () => {
      input.dispose()
      resize.dispose()
    },
  }
  views.set(id, view)
  return view
}

function attach(id: string, host: HTMLElement, write: (id: string, data: string) => void) {
  const view = ensure(id, write)
  if (view.terminal.element) host.append(view.terminal.element)
  else view.terminal.open(host)
  view.resizeObserver?.disconnect()
  view.resizeObserver = new ResizeObserver(() => fit(id))
  view.resizeObserver.observe(host)
  queueMicrotask(() => {
    fit(id)
    view.terminal.focus()
  })
  return () => {
    view.resizeObserver?.disconnect()
    view.resizeObserver = undefined
    if (view.terminal.element?.parentElement === host) dock().append(view.terminal.element)
  }
}

function dock() {
  if (detachedDock) return detachedDock
  detachedDock = document.createElement("div")
  detachedDock.style.display = "none"
  document.body.append(detachedDock)
  return detachedDock
}

function fit(id: string) {
  const view = views.get(id)
  if (!view?.terminal.element?.isConnected) return
  try {
    view.fit.fit()
  } catch {
    return
  }
}

function dispose(id: string) {
  const view = views.get(id)
  if (!view) return
  cancelRestart(id)
  openIDs.delete(id)
  view.resizeObserver?.disconnect()
  view.disposeInput()
  view.terminal.dispose()
  views.delete(id)
}
