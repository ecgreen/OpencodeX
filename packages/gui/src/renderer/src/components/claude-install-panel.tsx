import { Match, Show, Switch, createSignal, onCleanup, onMount } from "solid-js"
import { terminalSurface } from "./session-side-terminal"
import { Button, StatusBadge } from "./ui"

const INSTALL_TERMINAL_ID = "claude-install"
const STATUS_POLL_MS = 6_000

type InstallPhase = "idle" | "running" | "installed" | "failed"

/**
 * Guided install for the Claude Code CLI: one click runs the official install
 * script in a live terminal inside the dialog, then the panel polls the CLI
 * probe until the binary appears. Nothing runs until the user asks for it.
 */
export function ClaudeInstallPanel(props: { finish: (installed: boolean) => void }) {
  let host: HTMLDivElement | undefined
  const [phase, setPhase] = createSignal<InstallPhase>("idle")
  const [version, setVersion] = createSignal<string>()
  const [message, setMessage] = createSignal<string>()
  const cleanups: Array<() => void> = []
  let poll: ReturnType<typeof setInterval> | undefined

  const windows = navigator.userAgent.includes("Windows")
  const command = windows
    ? "irm https://claude.ai/install.ps1 | iex"
    : "curl -fsSL https://claude.ai/install.sh | bash"

  function write(id: string, data: string) {
    window.opencodex?.terminal?.write({ id, data })
  }

  function stopPolling() {
    if (poll === undefined) return
    clearInterval(poll)
    poll = undefined
  }

  async function checkInstalled() {
    const status = await window.opencodex?.claude?.status().catch(() => undefined)
    if (!status?.available) return false
    stopPolling()
    setVersion(status.version)
    setPhase("installed")
    return true
  }

  async function run() {
    const terminal = window.opencodex?.terminal
    if (!terminal || !host) {
      setPhase("failed")
      setMessage("Requires OpencodeX Desktop.")
      return
    }
    setPhase("running")
    try {
      const view = terminalSurface.ensure(INSTALL_TERMINAL_ID, write)
      terminalSurface.attach(INSTALL_TERMINAL_ID, host, write, undefined, false, true)
      const result = await terminal.create({ id: INSTALL_TERMINAL_ID, cols: 100, rows: 24, profile: { kind: "shell" } })
      if (!result.ok) {
        setPhase("failed")
        setMessage(result.message ?? "Could not open a terminal for the installation.")
        return
      }
      cleanups.push(terminal.onData((event) => {
        if (event.id === INSTALL_TERMINAL_ID) view.terminal.write(event.data)
      }))
      cleanups.push(terminal.onExit((event) => {
        if (event.id !== INSTALL_TERMINAL_ID) return
        // The shell closing is fine either way: the poll decides success.
        void checkInstalled()
      }))
      write(INSTALL_TERMINAL_ID, `${command}\r`)
      poll = setInterval(() => void checkInstalled(), STATUS_POLL_MS)
    } catch (error) {
      setPhase("failed")
      setMessage(error instanceof Error ? error.message : "Could not start the installation.")
    }
  }

  onMount(() => {
    // A fresh probe in case the CLI appeared since the dialog opened.
    void checkInstalled()
  })

  onCleanup(() => {
    stopPolling()
    cleanups.forEach((cleanup) => cleanup())
    void window.opencodex?.terminal?.destroy(INSTALL_TERMINAL_ID).catch(() => false)
    terminalSurface.dispose(INSTALL_TERMINAL_ID)
  })

  return (
    <div class="claude-install">
      <div class="claude-install-status" role="status">
        <Switch>
          <Match when={phase() === "installed"}>
            <StatusBadge status="success">Installed</StatusBadge>
            <span>Claude Code {version() ?? ""} is ready.</span>
          </Match>
          <Match when={phase() === "running"}>
            <StatusBadge status="running">Installing</StatusBadge>
            <span>Running the official install script. This can take a minute.</span>
          </Match>
          <Match when={phase() === "failed"}>
            <StatusBadge status="error">Failed</StatusBadge>
            <span>{message() ?? "The installation could not start."}</span>
          </Match>
          <Match when={phase() === "idle"}>
            <StatusBadge status="warning">Not installed</StatusBadge>
            <span>Claude Code was not found on this machine.</span>
          </Match>
        </Switch>
      </div>
      <Show when={phase() === "idle"}>
        <p class="claude-install-hint">
          This runs the official install script in a terminal below:
          <code>{command}</code>
        </p>
      </Show>
      <div class="claude-install-terminal" classList={{ active: phase() === "running" || phase() === "failed" }} ref={(element) => (host = element)} />
      <div class="claude-install-actions">
        <Button appearance="outline" onClick={() => openGuide()}>Installation guide</Button>
        <span class="claude-install-spacer" />
        <Button onClick={() => props.finish(false)}>Cancel</Button>
        <Switch>
          <Match when={phase() === "installed"}>
            <Button appearance="solid" tone="accent" onClick={() => props.finish(true)}>Continue</Button>
          </Match>
          <Match when={phase() === "running"}>
            <Button appearance="solid" tone="accent" disabled>Waiting for install…</Button>
          </Match>
          <Match when={phase() === "idle" || phase() === "failed"}>
            <Button appearance="solid" tone="accent" onClick={() => void run()}>{phase() === "failed" ? "Try again" : "Run install script"}</Button>
          </Match>
        </Switch>
      </div>
    </div>
  )
}

function openGuide() {
  const url = "https://code.claude.com/docs/en/installation"
  if (window.opencodex?.browser?.external) {
    void window.opencodex.browser.external(url)
    return
  }
  window.open(url, "_blank", "noopener,noreferrer")
}
