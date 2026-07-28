import { Show, createEffect, createSignal, onCleanup, type Accessor } from "solid-js"
import { compactPath } from "../lib/format"
import { Icon } from "./icon"
import type { OpenTab } from "./session-side-open-types"
import { TERMINAL_VIEW_LIMIT, attach, fit, sessionTerminal } from "./session-side-terminal-views"
import { IconButton, TextInput } from "./ui"

type TerminalTab = {
  id: string
  directory?: string
  terminalStatus?: "connecting" | "open" | "closed" | "error"
}

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
        <div class="session-open-terminal-title">
          <Show when={editing()} fallback={<span><Icon name="terminal" /> {props.tab.title || (props.tab.directory ? compactPath(props.tab.directory) : "Terminal")}</span>}>
            <TextInput value={title()} aria-label="Terminal name" autofocus onInput={(event) => setTitle(event.currentTarget.value)} onBlur={commitName} onKeyDown={(event) => event.key === "Enter" && commitName()} />
          </Show>
          <Show when={!editing()}>
            <IconButton appearance="ghost" icon="pencil" label="Rename terminal" size="compact" class="session-open-terminal-rename" onClick={() => setEditing(true)} />
          </Show>
        </div>
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
