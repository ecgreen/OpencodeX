import { FitAddon } from "@xterm/addon-fit"
import { Terminal } from "@xterm/xterm"
import "@xterm/xterm/css/xterm.css"
import { Show, createEffect, createSignal, onCleanup, type Accessor } from "solid-js"
import { compactPath } from "../lib/format"
import { Icon } from "./icon"
import type { OpenTab } from "./session-side-open-types"
import { IconButton, TextInput } from "./ui"

type TerminalTab = {
  id: string
  directory?: string
  terminalStatus?: "connecting" | "open" | "closed" | "error"
}

type TerminalView = {
  terminal: Terminal
  fit: FitAddon
  disposeInput: () => void
  openURL: (url: string) => void
  resizeObserver?: ResizeObserver
}

const views = new Map<string, TerminalView>()
const openIDs = new Set<string>()
const restartTimers = new Map<string, number>()
let detachedDock: HTMLDivElement | undefined
let themeObserver: MutationObserver | undefined
const TERMINAL_VIEW_LIMIT = 8

export function SessionOpenTerminal(props: { tab: TerminalTab & { title?: string }; write: (id: string, data: string) => void; rename: (id: string, title: string) => void }) {
  let host: HTMLDivElement | undefined
  const [editing, setEditing] = createSignal(false)
  const [title, setTitle] = createSignal(props.tab.title || "Terminal")

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
        <Show when={editing()} fallback={<span><Icon name="terminal" /> {props.tab.title || (props.tab.directory ? compactPath(props.tab.directory) : "Terminal")}</span>}>
          <TextInput value={title()} aria-label="Terminal name" autofocus onInput={(event) => setTitle(event.currentTarget.value)} onBlur={commitName} onKeyDown={(event) => event.key === "Enter" && commitName()} />
        </Show>
        <IconButton icon="pencil" label="Rename terminal" size="compact" onClick={() => setEditing(true)} />
        <small>{props.tab.terminalStatus === "closed" ? "closed" : props.tab.terminalStatus === "connecting" ? "connecting" : "interactive"}</small>
      </header>
      <div class="session-open-terminal-host" ref={(element) => { host = element }} />
    </div>
  )

  function commitName() {
    const value = title().trim() || "Terminal"
    setTitle(value)
    setEditing(false)
    props.rename(props.tab.id, value)
  }
}

export function createSessionSideTerminalController(input: {
  active: Accessor<boolean>
  tabs: Accessor<OpenTab[]>
  activeTab: Accessor<OpenTab | undefined>
  directory: Accessor<string>
  createTab: (input: Partial<OpenTab>) => string | undefined
  updateTab: (id: string, patch: Partial<OpenTab>) => void
  closeTab: (id: string) => void
  closeMenu: () => void
  openURL: (url: string) => void
}) {
  const startTokens = new Map<string, number>()

  createEffect(() => {
    const terminal = window.opencodex?.terminal
    if (!terminal) return
    const disposeData = terminal.onData((event) => {
      const tab = input.tabs().find((tab) => tab.id === event.id)
      if (tab?.kind !== "terminal") return
      sessionTerminal.cancelRestart(event.id)
      sessionTerminal.ensure(event.id, write, input.openURL).terminal.write(event.data)
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
      sessionTerminal.ensure(event.id, write, input.openURL).terminal.writeln(
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
    const terminalTabs = input.tabs().filter((tab) => tab.kind === "terminal")
    if (terminalTabs.length >= TERMINAL_VIEW_LIMIT) {
      input.closeTab(terminalTabs.find((tab) => tab.id !== input.activeTab()?.id)?.id ?? terminalTabs[0].id)
    }
    const id = input.createTab({
      kind: "terminal",
      title: "Terminal",
      directory: input.directory(),
      terminalStatus: "connecting",
      text: "",
    })
    if (!id) return
    sessionTerminal.markClosed(id)
    sessionTerminal.ensure(id, write, input.openURL)
    input.closeMenu()
    void start(id)
  }

  function close(tab: OpenTab) {
    if (tab.kind !== "terminal") return
    nextStartToken(tab.id)
    sessionTerminal.cancelRestart(tab.id)
    sessionTerminal.dispose(tab.id)
    void window.opencodex?.terminal?.destroy(tab.id).catch(() => undefined)
  }

  function closeAll(tabs: readonly OpenTab[] = input.tabs()) {
    tabs.forEach(close)
  }

  async function start(id: string) {
    const token = nextStartToken(id)
    if (!window.opencodex?.terminal) {
      sessionTerminal.ensure(id, write, input.openURL).terminal.writeln("Open terminal needs the latest desktop bridge. Restart OpencodeX and try again.")
      input.updateTab(id, { terminalStatus: "error" })
      return
    }
    const tab = input.tabs().find((tab) => tab.id === id)
    const result = await window.opencodex.terminal.create({ id, cwd: tab?.directory || input.directory(), cols: 100, rows: 30 })
    if (startTokens.get(id) !== token || !input.tabs().some((tab) => tab.id === id && tab.kind === "terminal")) {
      if (result.ok) void window.opencodex.terminal.destroy(id).catch(() => undefined)
      return
    }
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

  function rename(id: string, title: string) {
    input.updateTab(id, { title })
  }

  function nextStartToken(id: string) {
    const token = (startTokens.get(id) ?? 0) + 1
    startTokens.set(id, token)
    return token
  }

  onCleanup(() => {
    closeAll()
    startTokens.clear()
  })

  return { create, close, closeAll, write, rename }
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

function ensure(id: string, write: (id: string, data: string) => void, openURL?: (url: string) => void) {
  const existing = views.get(id)
  if (existing) {
    if (openURL) existing.openURL = openURL
    views.delete(id)
    views.set(id, existing)
    return existing
  }
  if (views.size >= TERMINAL_VIEW_LIMIT) {
    const oldest = views.keys().next().value
    if (oldest) {
      dispose(oldest)
      void window.opencodex?.terminal?.destroy(oldest).catch(() => undefined)
    }
  }
  ensureThemeSync()
  const terminal = new Terminal({
    cursorBlink: true,
    customGlyphs: true,
    letterSpacing: 0,
    scrollback: 10_000,
    fontFamily: '"Cascadia Mono", "Cascadia Code", "JetBrains Mono", "SFMono-Regular", Menlo, Consolas, monospace',
    fontSize: 13,
    lineHeight: 1,
    theme: terminalTheme(),
  })
  const fitAddon = new FitAddon()
  terminal.loadAddon(fitAddon)
  const input = terminal.onData((data) => write(id, data))
  const resize = terminal.onResize((size) => {
    void window.opencodex?.terminal?.resize({ id, cols: size.cols, rows: size.rows })
  })
  const links = terminal.registerLinkProvider({
    provideLinks(lineNumber, callback) {
      const line = terminal.buffer.active.getLine(lineNumber - 1)?.translateToString(true) ?? ""
      callback(Array.from(line.matchAll(/https?:\/\/[^\s<>"']+/g)).map((match) => {
        const text = match[0].replace(/[),.;]+$/, "")
        const start = (match.index ?? 0) + 1
        return {
          range: { start: { x: start, y: lineNumber }, end: { x: start + text.length, y: lineNumber } },
          text,
          activate: () => views.get(id)?.openURL(text),
        }
      }))
    },
  })
  const view: TerminalView = {
    terminal,
    fit: fitAddon,
    openURL: openURL ?? (() => undefined),
    disposeInput: () => {
      input.dispose()
      resize.dispose()
      links.dispose()
    },
  }
  views.set(id, view)
  return view
}

function ensureThemeSync() {
  if (themeObserver) return
  themeObserver = new MutationObserver(() => {
    const theme = terminalTheme()
    views.forEach((view) => { view.terminal.options.theme = theme })
  })
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] })
}

function terminalTheme() {
  const style = getComputedStyle(document.documentElement)
  const color = (name: string) => style.getPropertyValue(name).trim()
  const dark = style.colorScheme.includes("dark")
  return {
    background: color("--theme-canvas"), foreground: color("--theme-text"), cursor: color("--theme-accent"), cursorAccent: color("--theme-canvas"),
    selectionBackground: color("--theme-accent-soft"), selectionForeground: color("--theme-text"), selectionInactiveBackground: color("--theme-overlay-medium"),
    black: color(dark ? "--theme-text-muted" : "--theme-text"), red: color("--theme-danger"), green: color("--theme-success"), yellow: color("--theme-warning"),
    blue: color("--theme-info"), magenta: color("--theme-special"), cyan: color("--theme-syntax-type"), white: color(dark ? "--theme-text" : "--theme-text-muted"),
    brightBlack: color("--theme-text-subtle"), brightRed: color("--theme-danger"), brightGreen: color("--theme-success"), brightYellow: color("--theme-warning"),
    brightBlue: color("--theme-info"), brightMagenta: color("--theme-special"), brightCyan: color("--theme-syntax-type"), brightWhite: color("--theme-text"),
  }
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
  if (views.size > 0) return
  themeObserver?.disconnect()
  themeObserver = undefined
  detachedDock?.remove()
  detachedDock = undefined
}
