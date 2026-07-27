import type { GlobalEvent, OpencodeXTerminalSession } from "@opencode-ai/sdk/v2/client"
import { Match, Show, Switch, createEffect, createSignal, on, onCleanup, onMount } from "solid-js"
import type { createClaudeTerminalController } from "../controllers/claude-terminal-controller"
import type { GuiClient } from "../lib/client"
import { compactPath } from "../lib/format"
import type { GuiSnapshot } from "../lib/store"
import { claudeCanStart, claudeStartLabel, claudeStatusLabel } from "../lib/terminal-presentation"
import { Button, ErrorState, LoadingState, EmptyState, StatusBadge } from "./ui"
import { CardActionMenu } from "./card-action-menu"
import { SessionSidePanel, type SessionSidePanelRequest, type SessionSidePanelTarget } from "./session-side-panel"
import styles from "./claude-terminal-surface.module.css"

type Controller = ReturnType<typeof createClaudeTerminalController>

export function ClaudeTerminalSurface(props: {
  terminalSession: OpencodeXTerminalSession
  controller: Controller
  autoStart?: boolean
  focused?: boolean
}) {
  let host: HTMLDivElement | undefined
  const runtime = () => props.controller.runtime(props.terminalSession)

  // Keyed on the id: catalog record updates (timeOpened bumps on every launch)
  // must not tear the terminal out of the DOM and re-attach it.
  createEffect(on(() => props.terminalSession.id, () => {
    if (!host) return
    const detach = props.controller.attach(props.terminalSession, host, props.focused ?? false)
    onCleanup(detach)
  }))

  createEffect(() => {
    if (!props.autoStart || runtime().status !== "idle") return
    void props.controller.start(props.terminalSession)
  })

  createEffect(() => {
    if (!props.focused || runtime().status !== "running") return
    queueMicrotask(() => props.controller.focus(props.terminalSession))
  })

  const startAction = () => (
    <Show when={claudeCanStart(runtime())}>
      <Button appearance="solid" tone="accent" onClick={() => void props.controller.start(props.terminalSession)}>
        {claudeStartLabel(runtime())}
      </Button>
    </Show>
  )
  const description = () =>
    runtime().code === "desktop-required"
      ? "Open this session in OpencodeX Desktop to run the official Claude Code CLI."
      : runtime().message ?? stateMessage(runtime().status, props.terminalSession.resumeID)

  return (
    <section class={styles.root} aria-label={`${props.terminalSession.title} terminal`}>
      <div class={styles.host} ref={(element) => (host = element)} />
      <Show when={runtime().status !== "running"}>
        <div class={styles.state} role="status">
          <Switch fallback={<EmptyState compact class={styles.stateCard} title={stateTitle(runtime().status, runtime().code)} description={description()} action={startAction()} />}>
            <Match when={runtime().status === "starting"}>
              <LoadingState compact class={styles.stateCard} title={stateTitle(runtime().status, runtime().code)} description={description()} />
            </Match>
            <Match when={runtime().status === "error" || runtime().status === "wrong-device"}>
              <ErrorState compact class={styles.stateCard} title={stateTitle(runtime().status, runtime().code)} description={description()} action={startAction()} />
            </Match>
            <Match when={runtime().status === "missing-cli"}>
              <ErrorState compact class={styles.stateCard} title={stateTitle(runtime().status, runtime().code)} description={description()} action={
                <Button appearance="outline" onClick={() => void props.controller.start(props.terminalSession)}>
                  Check again
                </Button>
              } />
            </Match>
          </Switch>
        </div>
      </Show>
    </section>
  )
}

export function ClaudeTerminalPage(props: {
  terminalSession: OpencodeXTerminalSession
  controller: Controller
  rename?: () => void
  move?: () => void
  remove?: () => void
  gui?: GuiClient
  subscribeGlobalEvents?: (listener: (event: GlobalEvent) => void | Promise<void>) => () => void
  snapshot?: GuiSnapshot
}) {
  const runtime = () => props.controller.runtime(props.terminalSession)
  const actions = () => [
    ...(props.rename ? [{ label: "Rename", icon: "pencil", onSelect: props.rename }] : []),
    ...(props.move ? [{ label: "Move to project", icon: "folder", onSelect: props.move }] : []),
    ...(props.remove ? [{ label: "Remove", icon: "trash", danger: true, onSelect: props.remove }] : []),
  ]
  const [sidePanelOpen, setSidePanelOpen] = createSignal(false)
  const [sidePanelWidth, setSidePanelWidth] = createSignal(readSidePanelWidth())
  const [sidePanelRequest, setSidePanelRequest] = createSignal<SessionSidePanelRequest>()
  const resizeCleanups = new Set<() => void>()

  onMount(() => {
    const toggle = () => setSidePanelOpen((open) => !open)
    const open = (event: Event) => {
      setSidePanelOpen(true)
      const detail = (event as CustomEvent<SessionSidePanelTarget>).detail
      if (detail) setSidePanelRequest({ ...detail, token: Date.now() } as SessionSidePanelRequest)
    }
    window.addEventListener("opencodex:terminal-workspace-toggle", toggle)
    window.addEventListener("opencodex:terminal-workspace-open", open)
    onCleanup(() => {
      window.removeEventListener("opencodex:terminal-workspace-toggle", toggle)
      window.removeEventListener("opencodex:terminal-workspace-open", open)
    })
  })

  onCleanup(() => resizeCleanups.forEach((cleanup) => cleanup()))

  function startResize(event: PointerEvent & { currentTarget: HTMLElement }) {
    event.preventDefault()
    resizeCleanups.forEach((cleanup) => cleanup())
    const handle = event.currentTarget
    const pointerID = event.pointerId
    const width = handle.parentElement?.getBoundingClientRect().width ?? window.innerWidth
    const startX = event.clientX
    const startRatio = sidePanelWidth()
    handle.setPointerCapture?.(pointerID)
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId === pointerID) setSidePanelWidth(clampSidePanelWidth(startRatio - (moveEvent.clientX - startX) / width))
    }
    const cleanup = () => {
      if (!resizeCleanups.delete(cleanup)) return
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", finish)
      window.removeEventListener("pointercancel", finish)
      if (handle.hasPointerCapture?.(pointerID)) handle.releasePointerCapture?.(pointerID)
      localStorage.setItem("opencodex.gui.terminalSidePanel.width", String(sidePanelWidth()))
    }
    const finish = (finishEvent: PointerEvent) => {
      if (finishEvent.pointerId === pointerID) cleanup()
    }
    resizeCleanups.add(cleanup)
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", finish)
    window.addEventListener("pointercancel", finish)
  }

  return (
    <main class={styles.page}>
      <header class={styles.header}>
        <div class={styles.identity}>
          <strong>{props.terminalSession.title}</strong>
          <StatusBadge status="info">Claude Code</StatusBadge>
          <code title={props.terminalSession.directory}>{compactPath(props.terminalSession.directory)}</code>
        </div>
        <div class={styles.controls}>
          <StatusBadge status={runtime().status}>{claudeStatusLabel(runtime())}</StatusBadge>
          <Show when={runtime().status === "running"}>
            <Button appearance="outline" onClick={() => void props.controller.stop(props.terminalSession)}>Stop</Button>
          </Show>
          <Show when={claudeCanStart(runtime())}>
            <Button appearance="solid" tone="accent" onClick={() => void props.controller.start(props.terminalSession)}>{claudeStartLabel(runtime())}</Button>
          </Show>
          <Button appearance="ghost" icon="panel" aria-pressed={sidePanelOpen()} onClick={() => { setSidePanelOpen((open) => !open) }}>Workspace</Button>
          <Show when={actions().length > 0}>
            <CardActionMenu label={props.terminalSession.title} actions={actions()} />
          </Show>
        </div>
      </header>
      <div class={`session-main ${styles.main}`}>
        <ClaudeTerminalSurface
          terminalSession={props.terminalSession}
          controller={props.controller}
          autoStart
          focused
        />
        <SessionSidePanel
          open={sidePanelOpen()}
          widthRatio={sidePanelWidth()}
          sessionID={props.terminalSession.id}
          directory={props.terminalSession.directory}
          directoryOnly
          gui={props.gui}
          subscribeGlobalEvents={props.subscribeGlobalEvents}
          lsp={props.snapshot?.lsp ?? []}
          config={props.snapshot?.config}
          request={sidePanelRequest()}
          startResize={startResize}
          toggleMaximized={() => setSidePanelWidth((width) => width >= 0.68 ? 0.4 : 0.7)}
          resizeByKeyboard={(event) => {
            const next = event.key === "ArrowLeft" ? sidePanelWidth() + 0.04 : event.key === "ArrowRight" ? sidePanelWidth() - 0.04 : undefined
            if (next === undefined) return
            event.preventDefault()
            setSidePanelWidth(clampSidePanelWidth(next))
          }}
        />
      </div>
    </main>
  )
}

export function ClaudeTerminalViewPane(props: {
  terminalSession: OpencodeXTerminalSession
  controller: Controller
  focused: boolean
  autoStart: boolean
  focus: () => void
}) {
  const runtime = () => props.controller.runtime(props.terminalSession)
  return (
    <section class={`${styles.page} ${styles.pane}`} onPointerDown={props.focus}>
      <header class={`${styles.header} ${styles.paneHeader}`}>
        <div class={styles.identity}>
          <strong>{props.terminalSession.title}</strong>
          <StatusBadge status="info">Claude Code</StatusBadge>
          <code title={props.terminalSession.directory}>{compactPath(props.terminalSession.directory)}</code>
        </div>
        <div class={styles.controls}>
          <StatusBadge status={runtime().status}>{claudeStatusLabel(runtime())}</StatusBadge>
          <Show when={runtime().status === "running"}>
            <Button size="compact" appearance="outline" onClick={() => void props.controller.stop(props.terminalSession)}>Stop</Button>
          </Show>
          <Show when={claudeCanStart(runtime())}>
            <Button size="compact" appearance="solid" tone="accent" onClick={() => void props.controller.start(props.terminalSession)}>{claudeStartLabel(runtime())}</Button>
          </Show>
        </div>
      </header>
      <ClaudeTerminalSurface
        terminalSession={props.terminalSession}
        controller={props.controller}
        autoStart={props.autoStart}
        focused={props.focused}
      />
    </section>
  )
}

function stateTitle(status: ReturnType<Controller["runtime"]>["status"], code?: string) {
  if (code === "desktop-required") return "Requires OpencodeX Desktop"
  if (status === "starting") return "Starting Claude Code"
  if (status === "stopped") return "Claude Code stopped"
  if (status === "missing-cli") return "Claude Code is not installed"
  if (status === "wrong-device") return "Available on another device"
  if (status === "error") return "Claude Code could not start"
  return "Claude Code is ready"
}

function stateMessage(status: ReturnType<Controller["runtime"]>["status"], resumeID: string) {
  if (status === "starting") return "Opening the official Claude Code CLI in this working directory."
  if (status === "stopped") return `Resume the same Claude conversation (${resumeID}).`
  if (status === "wrong-device") return "This catalog record remains visible, but only its creating installation can launch it."
  if (status === "error") return `The saved Claude UUID is ${resumeID}. Retrying never creates a replacement conversation.`
  return "Authentication, permissions, models, and transcript storage remain owned by Claude Code."
}

function readSidePanelWidth() {
  if (typeof localStorage === "undefined") return 0.4
  return clampSidePanelWidth(Number(localStorage.getItem("opencodex.gui.terminalSidePanel.width")) || 0.4)
}

function clampSidePanelWidth(value: number) {
  return Math.max(0.28, Math.min(0.7, value))
}
