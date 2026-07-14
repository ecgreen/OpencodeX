import type { SessionMessage, SessionMessageAgentSwitched, SessionMessageAssistant, SessionMessageAssistantReasoning, SessionMessageAssistantText, SessionMessageAssistantTool, SessionMessageCompaction, SessionMessageModelSwitched, SessionMessageShell, SessionMessageUser } from "@opencode-ai/sdk/v2"
import { RGBA, type SyntaxStyle } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import stripAnsi from "strip-ansi"
import { For, Match, Show, Switch, createMemo, createSignal } from "solid-js"
import { SplitBorder } from "@tui/component/border"
import { Spinner } from "@tui/component/spinner"
import { useLocal } from "@tui/context/local"
import { reasoningSummary, useThinkingMode } from "@tui/context/thinking"
import { useTheme } from "@tui/context/theme"
import { Locale } from "@/util/locale"
import { collapseToolOutput } from "../../util/collapse-tool-output"
import { AssistantTool } from "./session-v2-tool"
import { BlockTool, MissingData } from "./session-v2-tool-primitives"

export function UserMessage(props: { message: SessionMessageUser; index: number }) {
  const { theme } = useTheme()
  const attachments = createMemo(() => [...(props.message.files ?? []), ...(props.message.agents ?? [])])
  return (
    <box
      id={props.message.id}
      border={["left"]}
      borderColor={theme.secondary}
      customBorderChars={SplitBorder.customBorderChars}
      marginTop={props.index === 0 ? 0 : 1}
      flexShrink={0}
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      backgroundColor={theme.backgroundPanel}
    >
      <text fg={theme.text}>{props.message.text}</text>
      <Show when={attachments().length}>
        <box flexDirection="row" paddingTop={1} gap={1} flexWrap="wrap">
          <For each={props.message.files ?? []}>
            {(file) => (
              <text fg={theme.text}>
                <span style={{ bg: theme.secondary, fg: theme.background }}> {file.mime} </span>
                <span style={{ bg: theme.backgroundElement, fg: theme.textMuted }}> {file.name ?? file.uri} </span>
              </text>
            )}
          </For>
          <For each={props.message.agents ?? []}>
            {(agent) => (
              <text fg={theme.text}>
                <span style={{ bg: theme.accent, fg: theme.background }}> agent </span>
                <span style={{ bg: theme.backgroundElement, fg: theme.textMuted }}> {agent.name} </span>
              </text>
            )}
          </For>
        </box>
      </Show>
    </box>
  )
}

export function ShellMessage(props: { message: SessionMessageShell }) {
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()
  const output = createMemo(() => stripAnsi(props.message.output.trim()))
  const [expanded, setExpanded] = createSignal(false)
  const maxLines = 10
  const maxChars = createMemo(() => maxLines * Math.max(20, dimensions().width - 6))
  const collapsed = createMemo(() => collapseToolOutput(output(), maxLines, maxChars()))
  const limited = createMemo(() => {
    if (expanded() || !collapsed().overflow) return output()
    return collapsed().output
  })
  return (
    <BlockTool
      title="# Shell"
      spinner={!props.message.time.completed}
      onClick={collapsed().overflow ? () => setExpanded((prev) => !prev) : undefined}
    >
      <box gap={1}>
        <text fg={theme.text}>$ {props.message.command}</text>
        <Show when={output()}>
          <text fg={theme.text}>{limited()}</text>
        </Show>
        <Show when={collapsed().overflow}>
          <text fg={theme.textMuted}>{expanded() ? "Click to collapse" : "Click to expand"}</text>
        </Show>
      </box>
    </BlockTool>
  )
}

export function CompactionMessage(props: { message: SessionMessageCompaction }) {
  const { theme, syntax } = useTheme()
  return (
    <box
      marginTop={1}
      border={["top"]}
      title={props.message.reason === "auto" ? " Auto Compaction " : " Compaction "}
      titleAlignment="center"
      borderColor={theme.borderActive}
      flexShrink={0}
    >
      <Show when={props.message.summary}>
        {(summary) => (
          <box paddingLeft={3} paddingTop={1}>
            <code
              filetype="markdown"
              drawUnstyledText={false}
              streaming={false}
              syntaxStyle={syntax()}
              content={summary().trim()}
              conceal={true}
              fg={theme.text}
            />
          </box>
        )}
      </Show>
    </box>
  )
}

export function AgentSwitchedMessage(props: { message: SessionMessageAgentSwitched }) {
  const { theme } = useTheme()
  const local = useLocal()
  return (
    <box paddingLeft={3} marginTop={1} flexShrink={0}>
      <text>
        <span style={{ fg: local.agent.color(props.message.agent) }}>â–£ </span>
        <span style={{ fg: theme.textMuted }}>Switched agent to </span>
        <span style={{ fg: theme.text }}>{Locale.titlecase(props.message.agent)}</span>
      </text>
    </box>
  )
}

export function ModelSwitchedMessage(props: { message: SessionMessageModelSwitched }) {
  const { theme } = useTheme()
  const model = createMemo(() => {
    const variant = props.message.model.variant ? `/${props.message.model.variant}` : ""
    return `${props.message.model.providerID}/${props.message.model.id}${variant}`
  })
  return (
    <box paddingLeft={3} marginTop={1} flexShrink={0}>
      <text>
        <span style={{ fg: theme.secondary }}>â—‡ </span>
        <span style={{ fg: theme.textMuted }}>Switched model to </span>
        <span style={{ fg: theme.text }}>{model()}</span>
      </text>
    </box>
  )
}

export function UnknownMessage(props: { message: SessionMessage }) {
  return <MissingData label="Unknown message type" detail={JSON.stringify(props.message)} />
}

export function AssistantMessage(props: {
  message: SessionMessageAssistant
  sessionID: string
  last: boolean
  syntax: SyntaxStyle
  subtleSyntax: SyntaxStyle
  start?: number
}) {
  const { theme } = useTheme()
  const local = useLocal()
  const duration = createMemo(() => {
    if (!props.message.time.completed) return 0
    return props.message.time.completed - (props.start ?? props.message.time.created)
  })
  const model = createMemo(() => {
    const variant = props.message.model.variant ? `/${props.message.model.variant}` : ""
    return `${props.message.model.providerID}/${props.message.model.id}${variant}`
  })
  const final = createMemo(() => props.message.finish && !["tool-calls", "unknown"].includes(props.message.finish))
  return (
    <>
      <For each={props.message.content}>
        {(part) => (
          <Switch>
            <Match when={part.type === "text"}>
              <AssistantText part={part as SessionMessageAssistantText} syntax={props.syntax} />
            </Match>
            <Match when={part.type === "reasoning"}>
              <AssistantReasoning
                part={part as SessionMessageAssistantReasoning}
                subtleSyntax={props.subtleSyntax}
                completedAt={() => props.message.time.completed}
              />
            </Match>
            <Match when={part.type === "tool"}>
              <AssistantTool part={part as SessionMessageAssistantTool} sessionID={props.sessionID} />
            </Match>
          </Switch>
        )}
      </For>
      <Show when={props.message.content.length === 0}>
        <MissingData label="Assistant content" detail={`Assistant message ${props.message.id} has no content items.`} />
      </Show>
      <Show when={props.message.error}>
        <box
          border={["left"]}
          paddingTop={1}
          paddingBottom={1}
          paddingLeft={2}
          marginTop={1}
          backgroundColor={theme.backgroundPanel}
          customBorderChars={SplitBorder.customBorderChars}
          borderColor={theme.error}
          flexShrink={0}
        >
          <text fg={theme.textMuted}>{props.message.error}</text>
        </box>
      </Show>
      <Show when={props.last || final() || props.message.error}>
        <box paddingLeft={3} flexShrink={0}>
          <text marginTop={1}>
            <span style={{ fg: local.agent.color(props.message.agent) }}>â–£ </span>
            <span style={{ fg: theme.text }}>{Locale.titlecase(props.message.agent)}</span>
            <span style={{ fg: theme.textMuted }}> Â· {model()}</span>
            <Show when={duration()}>
              <span style={{ fg: theme.textMuted }}> Â· {Locale.duration(duration())}</span>
            </Show>
          </text>
        </box>
      </Show>
    </>
  )
}

function AssistantText(props: { part: SessionMessageAssistantText; syntax: SyntaxStyle }) {
  const { theme } = useTheme()
  return (
    <Show when={props.part.text.trim()}>
      <box paddingLeft={3} marginTop={1} flexShrink={0} id="text">
        <code
          filetype="markdown"
          drawUnstyledText={false}
          streaming={true}
          syntaxStyle={props.syntax}
          content={props.part.text.trim()}
          conceal={true}
          fg={theme.text}
        />
      </box>
    </Show>
  )
}

function AssistantReasoning(props: {
  part: SessionMessageAssistantReasoning
  subtleSyntax: SyntaxStyle
  completedAt: () => number | undefined
}) {
  const { theme } = useTheme()
  const thinking = useThinkingMode()
  const [expanded, setExpanded] = createSignal(false)
  const content = createMemo(() => props.part.text.replace("[REDACTED]", "").trim())
  const inMinimal = createMemo(() => thinking.mode() === "hide")
  // v2 reasoning parts have no per-part `time.end` (see SessionMessageAssistantReasoning
  // in the v2 SDK); we settle on parent-message completion instead.
  const isDone = createMemo(() => props.completedAt() !== undefined)
  const summary = createMemo(() => reasoningSummary(content()))

  const toggle = () => {
    if (!inMinimal()) return
    setExpanded((prev) => !prev)
  }

  return (
    <Show when={content()}>
      <box paddingLeft={3} marginTop={1} flexDirection="column" flexShrink={0}>
        <box onMouseUp={toggle}>
          <ReasoningHeader
            toggleable={inMinimal()}
            open={!inMinimal() || expanded()}
            done={isDone()}
            title={summary().title}
          />
        </box>
        <Show when={(!inMinimal() || expanded()) && summary().body}>
          <box paddingLeft={inMinimal() ? 2 : 0} marginTop={1}>
            <code
              filetype="markdown"
              drawUnstyledText={false}
              streaming={true}
              syntaxStyle={props.subtleSyntax}
              content={summary().body}
              conceal={true}
              fg={theme.textMuted}
            />
          </box>
        </Show>
      </box>
    </Show>
  )
}

function ReasoningHeader(props: { toggleable: boolean; open: boolean; done: boolean; title: string | null }) {
  const { theme } = useTheme()
  const fg = () =>
    props.open
      ? RGBA.fromValues(theme.warning.r, theme.warning.g, theme.warning.b, theme.thinkingOpacity)
      : theme.warning

  return (
    <Switch>
      <Match when={!props.done}>
        <box flexDirection="row">
          <Spinner color={fg()}>{props.title ? "Thinking: " + props.title : "Thinking"}</Spinner>
        </box>
      </Match>
      <Match when={true}>
        <text fg={fg()} wrapMode="none">
          <Show when={props.toggleable}>
            <span>{props.open ? "- " : "+ "}</span>
          </Show>
          <span>Thought</span>
          <Show when={props.title}>
            <span>: </span>
            <span>{props.title}</span>
          </Show>
        </text>
      </Match>
    </Switch>
  )
}
