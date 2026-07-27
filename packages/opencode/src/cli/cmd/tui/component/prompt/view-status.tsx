import type { Accessor, JSX } from "solid-js"
import { createMemo, createSignal, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import "opentui-spinner/solid"
import type { SessionStatus } from "@opencode-ai/sdk/v2"
import { useDialog } from "@tui/ui/dialog"
import { useLocal } from "@tui/context/local"
import { useTheme } from "@tui/context/theme"
import { useCommandShortcut } from "../../keymap"
import { useKV } from "../../context/kv"
import { DialogAlert } from "../../ui/dialog-alert"
import { Spinner } from "@tui/component/spinner"
import { formatDuration } from "@/util/format"
import { createColors, createFrames } from "../../ui/spinner"
import type { createPromptEditorContext } from "./editor-context"
import type { createPromptOpencodeXContext } from "./opencodex"
import type { createPromptSessionContext } from "./session-context"
import type { PromptState } from "./types"
import type { createPromptWorkspaceController } from "./workspace"

export function PromptStatusBar(input: {
  status: Accessor<SessionStatus>
  state: PromptState
  hint?: JSX.Element
  editor: ReturnType<typeof createPromptEditorContext>
  opencodex: ReturnType<typeof createPromptOpencodeXContext>
  session: ReturnType<typeof createPromptSessionContext>
  workspace: ReturnType<typeof createPromptWorkspaceController>
}) {
  const agentShortcut = useCommandShortcut("agent.cycle")
  const paletteShortcut = useCommandShortcut("command.palette.show")
  const dialog = useDialog()
  const kv = useKV()
  const local = useLocal()
  const { theme } = useTheme()
  const spinner = createMemo(() => {
    const agent = input.status().type !== "idle"
      ? local.agent.list().find((item) => item.name === input.session.lastUserMessage()?.agent) ?? local.agent.current()
      : input.session.agent()
    const color = agent ? local.agent.color(agent.name) : theme.border
    return {
      frames: createFrames({ color, style: "blocks", inactiveFactor: 0.6, minAlpha: 0.3 }),
      color: createColors({ color, style: "blocks", inactiveFactor: 0.6, minAlpha: 0.3 }),
    }
  })

  return (
    <box width="100%" flexDirection="row" justifyContent="space-between">
      <Switch>
        <Match when={input.status().type !== "idle"}>
          <box flexDirection="row" gap={1} flexGrow={1} justifyContent={input.status().type === "retry" ? "space-between" : "flex-start"}>
            <box flexShrink={0} flexDirection="row" gap={1}>
              <box marginLeft={1}>
                <Show when={kv.get("animations_enabled", true)} fallback={<text fg={theme.textMuted}>[⋯]</text>}>
                  <spinner color={spinner().color} frames={spinner().frames} interval={40} />
                </Show>
              </box>
              <RetryStatus status={input.status} />
            </box>
            <text fg={input.state.interrupt > 0 ? theme.primary : theme.text}>
              esc{" "}<span style={{ fg: input.state.interrupt > 0 ? theme.primary : theme.textMuted }}>
                {input.state.interrupt > 0 ? "again to interrupt" : "interrupt"}
              </span>
            </text>
          </box>
        </Match>
        <Match when={input.workspace.notice()}>
          {(notice) => <box paddingLeft={3}><text fg={theme.accent}>{notice()}</text></box>}
        </Match>
        <Match when={input.workspace.label()}>
          {(label) => (
            <box paddingLeft={3} flexDirection="row" gap={1}>
              <Show when={input.workspace.creating()}><Spinner color={theme.accent} /></Show>
              <text fg={input.workspace.creating() ? theme.accent : theme.text}>
                {(() => {
                  const item = label()
                  if (item.type !== "new") return <>Workspace <span style={{ fg: theme.textMuted }}>{item.workspaceName}</span></>
                  if (input.workspace.creating()) return `Creating ${item.workspaceType}${".".repeat(input.workspace.creatingDots())}`
                  return <>Workspace <span style={{ fg: theme.textMuted }}>(new {item.workspaceType})</span></>
                })()}
              </text>
            </box>
          )}
        </Match>
        <Match when={input.opencodex.deletedSwarmSession()}>
          <box paddingLeft={3}><text fg={theme.warning}>Deleted swarm session is read-only. Slash commands still work.</text></box>
        </Match>
        <Match when={true}>{input.hint ?? <text />}</Match>
      </Switch>
      <Show when={input.status().type !== "retry"}>
        <box gap={2} flexDirection="row">
          <Show when={input.editor.labelState() !== "none" ? input.editor.displayLabel() : undefined}>
            {(file) => <text fg={input.editor.labelState() === "pending" ? theme.secondary : theme.textMuted}>{file()}</text>}
          </Show>
          <Switch>
            <Match when={input.state.mode === "normal"}>
              <Switch>
                <Match when={input.session.usage()}>
                  {(usage) => <text fg={theme.textMuted} wrapMode="none">{[usage().context, usage().cost].filter(Boolean).join(" · ")}</text>}
                </Match>
                <Match when={true}><text fg={theme.text}>{agentShortcut()} <span style={{ fg: theme.textMuted }}>agents</span></text></Match>
              </Switch>
              <text fg={theme.text}>{paletteShortcut()} <span style={{ fg: theme.textMuted }}>commands</span></text>
            </Match>
            <Match when={input.state.mode === "shell"}>
              <text fg={theme.text}>esc <span style={{ fg: theme.textMuted }}>exit shell mode</span></text>
            </Match>
          </Switch>
        </box>
      </Show>
    </box>
  )
}

function RetryStatus(input: { status: Accessor<SessionStatus> }) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const retry = createMemo(() => {
    const status = input.status()
    return status.type === "retry" ? status : undefined
  })
  const [seconds, setSeconds] = createSignal(0)
  onMount(() => {
    const timer = setInterval(() => {
      const next = retry()?.next
      if (next) setSeconds(Math.round((next - Date.now()) / 1000))
    }, 1000)
    onCleanup(() => clearInterval(timer))
  })
  const message = createMemo(() => {
    const value = retry()
    if (!value || value.type !== "retry") return
    if (value.message.includes("exceeded your current quota") && value.message.includes("gemini")) return "gemini is way too hot right now"
    return value.message.length > 80 ? value.message.slice(0, 80) + "..." : value.message
  })
  const text = createMemo(() => {
    const value = retry()
    if (!value || value.type !== "retry") return ""
    const hint = value.message.length > 120 ? " (click to expand)" : ""
    const duration = formatDuration(seconds())
    return `${message()}${hint} [retrying ${duration ? `in ${duration} ` : ""}attempt #${value.attempt}]`
  })
  return (
    <Show when={retry()}>
      <box onMouseUp={() => {
        const value = retry()
        if (value?.type === "retry" && value.message.length > 120) void DialogAlert.show(dialog, "Retry Error", value.message)
      }}><text fg={theme.error}>{text()}</text></box>
    </Show>
  )
}
