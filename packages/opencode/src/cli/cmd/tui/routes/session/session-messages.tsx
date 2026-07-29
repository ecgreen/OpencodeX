import type { AssistantMessage, Part, ReasoningPart, TextPart, UserMessage } from "@opencode-ai/sdk/v2"
import { RGBA } from "@opentui/core"
import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js"
import { Locale } from "@/util/locale"
import { SplitBorder } from "@tui/component/border"
import { Spinner } from "@tui/component/spinner"
import { useLocal } from "@tui/context/local"
import { generateSubtleSyntax, selectedForeground, useTheme } from "@tui/context/theme"
import { useSync } from "@tui/context/sync"
import { reasoningSummary } from "@tui/context/thinking"
import { useCommandShortcut } from "@tui/keymap"
import { name } from "@tui/util/model"
import { useSessionView } from "./session-view-context"
import { SessionToolPart } from "./session-tool-renderer"

const MIME_BADGE: Record<string, string> = {
  "text/plain": "txt",
  "image/png": "img",
  "image/jpeg": "img",
  "image/gif": "img",
  "image/webp": "img",
  "application/pdf": "pdf",
  "application/x-directory": "dir",
}

export function SessionUserMessage(props: {
  message: UserMessage
  parts: Part[]
  onMouseUp(): void
  index: number
  pending?: string
}) {
  const context = useSessionView()
  const local = useLocal()
  const { theme } = useTheme()
  const [hover, setHover] = createSignal(false)
  const text = createMemo(() => props.parts
    .filter((part): part is TextPart => part.type === "text" && !part.synthetic)
    .map((part) => part.text)
    .join("\n\n"))
  const files = createMemo(() => props.parts.filter((part) => part.type === "file"))
  const queued = createMemo(() => Boolean(props.pending && props.message.id > props.pending))
  const color = createMemo(() => local.agent.color(props.message.agent))
  const metadataVisible = createMemo(() => queued() || context.showTimestamps())
  const compaction = createMemo(() => props.parts.some((part) => part.type === "compaction"))
  return (
    <>
      <Show when={text()}>
        <box
          id={props.message.id}
          border={["left"]}
          borderColor={color()}
          customBorderChars={SplitBorder.customBorderChars}
          marginTop={props.index === 0 ? 0 : 1}
        >
          <box
            onMouseOver={() => setHover(true)}
            onMouseOut={() => setHover(false)}
            onMouseUp={props.onMouseUp}
            paddingTop={1}
            paddingBottom={1}
            paddingLeft={2}
            backgroundColor={hover() ? theme.backgroundElement : theme.backgroundPanel}
            flexShrink={0}
          >
            <text fg={theme.text}>{text()}</text>
            <Show when={files().length}>
              <box flexDirection="row" paddingBottom={metadataVisible() ? 1 : 0} paddingTop={1} gap={1} flexWrap="wrap">
                <For each={files()}>{(file) => (
                  <text fg={theme.text}>
                    <span style={{ bg: file.mime.startsWith("image/") ? theme.accent : file.mime === "application/pdf" ? theme.primary : theme.secondary, fg: theme.background }}>
                      {` ${MIME_BADGE[file.mime] ?? file.mime} `}
                    </span>
                    <span style={{ bg: theme.backgroundElement, fg: theme.textMuted }}>{` ${file.filename} `}</span>
                  </text>
                )}</For>
              </box>
            </Show>
            <Show
              when={queued()}
              fallback={<Show when={context.showTimestamps()}><text fg={theme.textMuted}>{Locale.todayTimeOrDateTime(props.message.time.created)}</text></Show>}
            >
              <text fg={theme.textMuted}>
                <span style={{ bg: color(), fg: selectedForeground(theme, color()), bold: true }}> QUEUED </span>
              </text>
            </Show>
          </box>
        </box>
      </Show>
      <Show when={compaction()}>
        <box marginTop={1} border={["top"]} title=" Compaction " titleAlignment="center" borderColor={theme.borderActive} />
      </Show>
    </>
  )
}

export function SessionAssistantMessage(props: { message: AssistantMessage; parts: Part[]; last: boolean }) {
  const context = useSessionView()
  const local = useLocal()
  const { theme } = useTheme()
  const sync = useSync()
  const messages = createMemo(() => sync.data.message[props.message.sessionID] ?? [])
  const model = createMemo(() => name(context.providers(), props.message.providerID, props.message.modelID))
  const final = createMemo(() => Boolean(props.message.finish && !["tool-calls", "unknown"].includes(props.message.finish)))
  const duration = createMemo(() => {
    if (!final() || !props.message.time.completed) return 0
    const user = messages().find((message) => message.role === "user" && message.id === props.message.parentID)
    return user ? props.message.time.completed - user.time.created : 0
  })
  const childShortcut = useCommandShortcut("session.child.first")
  return (
    <>
      <For each={props.parts}>{(part, index) => (
        <Switch>
          <Match when={part.type === "text" ? part : undefined} keyed>{(text) => <SessionTextPart part={text} />}</Match>
          <Match when={part.type === "reasoning" ? part : undefined} keyed>{(reasoning) => <SessionReasoningPart part={reasoning} />}</Match>
          <Match when={part.type === "tool" ? part : undefined} keyed>{(tool) => <SessionToolPart last={index() === props.parts.length - 1} part={tool} message={props.message} />}</Match>
        </Switch>
      )}</For>
      <Show when={props.parts.some((part) => part.type === "tool" && part.tool === "task")}>
        <box paddingTop={1} paddingLeft={3}>
          <text fg={theme.text}>{childShortcut()}<span style={{ fg: theme.textMuted }}> view subagents</span></text>
        </box>
      </Show>
      <Show when={props.message.error && props.message.error.name !== "MessageAbortedError"}>
        <box border={["left"]} paddingTop={1} paddingBottom={1} paddingLeft={2} marginTop={1} backgroundColor={theme.backgroundPanel} customBorderChars={SplitBorder.customBorderChars} borderColor={theme.error}>
          <text fg={theme.textMuted}>{props.message.error?.data.message}</text>
        </box>
      </Show>
      <Show when={props.last || final() || props.message.error?.name === "MessageAbortedError"}>
        <box paddingLeft={3}>
          <text marginTop={1}>
            <span style={{ fg: props.message.error?.name === "MessageAbortedError" ? theme.textMuted : local.agent.color(props.message.agent) }}>▣ </span>
            <span style={{ fg: theme.text }}>{Locale.titlecase(props.message.mode)}</span>
            <span style={{ fg: theme.textMuted }}> · {model()}</span>
            <Show when={duration()}><span style={{ fg: theme.textMuted }}> · {Locale.duration(duration())}</span></Show>
            <Show when={props.message.error?.name === "MessageAbortedError"}><span style={{ fg: theme.textMuted }}> · interrupted</span></Show>
          </text>
        </box>
      </Show>
    </>
  )
}

function SessionReasoningPart(props: { part: ReasoningPart }) {
  const { theme } = useTheme()
  const context = useSessionView()
  const [expanded, setExpanded] = createSignal(false)
  const content = createMemo(() => props.part.text.replace("[REDACTED]", "").trim())
  const done = createMemo(() => props.part.time.end !== undefined)
  const minimal = createMemo(() => context.thinkingMode() === "hide")
  const duration = createMemo(() => props.part.time.end === undefined ? 0 : Math.max(0, props.part.time.end - props.part.time.start))
  const summary = createMemo(() => reasoningSummary(content()))
  const syntax = createMemo(() => generateSubtleSyntax(theme))
  return (
    <Show when={content()}>
      <box id={"text-" + props.part.id} paddingLeft={3} marginTop={1} flexDirection="column" flexShrink={0}>
        <box onMouseUp={() => minimal() && setExpanded((value) => !value)}>
          <ReasoningHeader toggleable={minimal()} open={!minimal() || expanded()} done={done()} title={summary().title} duration={done() ? Locale.duration(duration()) : undefined} />
        </box>
        <Show when={(!minimal() || expanded()) && summary().body}>
          <box paddingLeft={minimal() ? 2 : 0} marginTop={1}>
            <code filetype="markdown" drawUnstyledText={false} streaming={true} syntaxStyle={syntax()} content={summary().body} conceal={context.conceal()} fg={theme.textMuted} />
          </box>
        </Show>
      </box>
    </Show>
  )
}

function ReasoningHeader(props: { toggleable: boolean; open: boolean; done: boolean; title: string | null; duration?: string }) {
  const { theme } = useTheme()
  const color = () => props.open ? RGBA.fromValues(theme.warning.r, theme.warning.g, theme.warning.b, theme.thinkingOpacity) : theme.warning
  return (
    <Switch>
      <Match when={!props.done}><box flexDirection="row"><Spinner color={color()}>{props.title ? "Thinking: " + props.title : "Thinking"}</Spinner></box></Match>
      <Match when={true}>
        <text fg={color()} wrapMode="none">
          <Show when={props.toggleable}><span>{props.open ? "- " : "+ "}</span></Show>
          <span>Thought</span>
          <Show when={props.title || props.duration}><span>: </span></Show>
          <Show when={props.title}><span>{props.title}</span></Show>
          <Show when={props.duration}><span>{props.title ? " · " : ""}{props.duration}</span></Show>
        </text>
      </Match>
    </Switch>
  )
}

function SessionTextPart(props: { part: TextPart }) {
  const context = useSessionView()
  const { theme, syntax } = useTheme()
  // A streaming part re-renders on every delta batch. `trim()` copies the whole
  // accumulated text each time, so only pay for it once the part is finished;
  // while streaming, a regex is enough to answer "is there any content yet".
  // Timeless parts (user prompts, synthetic) never stream and are final.
  const content = createMemo(() =>
    props.part.time !== undefined && props.part.time.end === undefined ? props.part.text : props.part.text.trim(),
  )
  return (
    <Show when={/\S/.test(content())}>
      <box id={"text-" + props.part.id} paddingLeft={3} marginTop={1} flexShrink={0}>
        <markdown syntaxStyle={syntax()} streaming={true} internalBlockMode="top-level" content={content()} tableOptions={{ style: "grid" }} conceal={context.conceal()} fg={theme.markdownText} bg={theme.background} />
      </box>
    </Show>
  )
}
