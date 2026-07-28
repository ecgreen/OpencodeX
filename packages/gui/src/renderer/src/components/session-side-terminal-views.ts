import { FitAddon } from "@xterm/addon-fit"
import { Terminal } from "@xterm/xterm"
import "@xterm/xterm/css/xterm.css"
import { exitDescription, exitShouldRestart, terminalTheme } from "../lib/terminal-presentation"

type TerminalView = {
  terminal: Terminal
  fit: FitAddon
  disposeInput: () => void
  openURL: (url: string) => void
  resizeObserver?: ResizeObserver
  persistent: boolean
}

const views = new Map<string, TerminalView>()
const openIDs = new Set<string>()
const restartTimers = new Map<string, number>()
let detachedDock: HTMLDivElement | undefined
let themeObserver: MutationObserver | undefined
export const TERMINAL_VIEW_LIMIT = 8

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

export const terminalSurface = {
  attach(
    id: string,
    host: HTMLElement,
    write: (id: string, data: string) => void,
    openURL?: (url: string) => void,
    persistent = false,
    focus = true,
  ) {
    return attach(id, host, write, openURL, persistent, focus)
  },
  dispose,
  ensure(
    id: string,
    write: (id: string, data: string) => void,
    openURL?: (url: string) => void,
    persistent = false,
  ) {
    return ensure(id, write, openURL, persistent)
  },
  fit,
  focus: (id: string) => sessionTerminal.focus(id),
  markClosed: (id: string) => sessionTerminal.markClosed(id),
  markOpen: (id: string) => sessionTerminal.markOpen(id),
}

function cancelRestart(id: string) {
  const timer = restartTimers.get(id)
  if (timer === undefined) return
  window.clearTimeout(timer)
  restartTimers.delete(id)
}

function ensure(
  id: string,
  write: (id: string, data: string) => void,
  openURL?: (url: string) => void,
  persistent = false,
) {
  const existing = views.get(id)
  if (existing) {
    if (openURL) existing.openURL = openURL
    if (persistent) existing.persistent = true
    views.delete(id)
    views.set(id, existing)
    return existing
  }
  if (views.size >= TERMINAL_VIEW_LIMIT) {
    const oldest = [...views].find(([, view]) => !view.persistent)?.[0]
    if (!oldest) throw new Error("This window already has the maximum of 8 terminals open.")
    dispose(oldest)
    void window.opencodex?.terminal?.destroy(oldest).catch(() => undefined)
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
    persistent,
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

export function attach(
  id: string,
  host: HTMLElement,
  write: (id: string, data: string) => void,
  openURL?: (url: string) => void,
  persistent = false,
  focus = true,
) {
  const view = ensure(id, write, openURL, persistent)
  if (view.terminal.element) host.append(view.terminal.element)
  else view.terminal.open(host)
  view.resizeObserver?.disconnect()
  view.resizeObserver = new ResizeObserver(() => fit(id))
  view.resizeObserver.observe(host)
  // Panes re-attach on reorder; only the focused one may claim the keyboard.
  queueMicrotask(() => {
    fit(id)
    if (focus) view.terminal.focus()
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

export function fit(id: string) {
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
