import stripAnsi from "strip-ansi"
import { createEffect, createMemo, createSignal, For, Match, onCleanup, Show, Switch } from "solid-js"
import type { QuestionTool } from "@/tool/question"
import { ShellTool } from "@/tool/shell"
import type { SkillTool } from "@/tool/skill"
import type { TaskTool } from "@/tool/task"
import { TodoWriteTool } from "@/tool/todo"
import type { WebFetchTool } from "@/tool/webfetch"
import { webSearchProviderLabel, type WebSearchTool } from "@/tool/websearch"
import { Locale } from "@/util/locale"
import { TodoItem } from "@tui/component/todo-item"
import { usePathFormatter } from "@tui/context/path-format"
import { useRoute } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { useTheme } from "@tui/context/theme"
import { useDialog } from "@tui/ui/dialog"
import { DialogAlert } from "@tui/ui/dialog-alert"
import { collapseToolOutput } from "@tui/util/collapse-tool-output"
import { useSessionView } from "./session-view-context"
import { BlockTool, InlineTool } from "./session-tool-core"
import { formatToolInput, type SessionToolProps } from "./session-tool-types"

export function Shell(props: SessionToolProps<typeof ShellTool>) {
  const { theme } = useTheme()
  const pathFormatter = usePathFormatter()
  const context = useSessionView()
  const output = createMemo(() => stripAnsi(props.metadata.output?.trim() ?? ""))
  const [expanded, setExpanded] = createSignal(false)
  const collapsed = createMemo(() => collapseToolOutput(output(), 10, 10 * Math.max(20, context.width - 6)))
  const limited = createMemo(() => expanded() || !collapsed().overflow ? output() : collapsed().output)
  const workdir = createMemo(() => !props.input.workdir || props.input.workdir === "." ? undefined : pathFormatter.format(props.input.workdir))
  const title = createMemo(() => {
    const description = props.input.description ?? "Shell"
    if (!workdir() || description.includes(workdir()!)) return `# ${description}`
    return `# ${description} in ${workdir()}`
  })
  return (
    <Switch>
      <Match when={props.metadata.output !== undefined}>
        <BlockTool
          title={title()}
          part={props.part}
          spinner={props.part.state.status === "running"}
          onClick={collapsed().overflow ? () => setExpanded((value) => !value) : undefined}
        >
          <box gap={1}>
            <text fg={theme.text}>$ {props.input.command}</text>
            <Show when={output()}><text fg={theme.text}>{limited()}</text></Show>
            <Show when={collapsed().overflow}>
              <text fg={theme.textMuted}>{expanded() ? "Click to collapse" : "Click to expand"}</text>
            </Show>
          </box>
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="$" pending="Writing command..." complete={props.input.command} part={props.part}>
          {props.input.command}
        </InlineTool>
      </Match>
    </Switch>
  )
}

export function WebFetch(props: SessionToolProps<typeof WebFetchTool>) {
  return <InlineTool icon="%" pending="Fetching from the web..." complete={props.input.url} part={props.part}>WebFetch {props.input.url}</InlineTool>
}

export function WebSearch(props: SessionToolProps<typeof WebSearchTool>) {
  const metadata = () => props.metadata as typeof props.metadata & { numResults?: number }
  return (
    <InlineTool icon="◈" pending="Searching web..." complete={props.input.query} part={props.part}>
      {webSearchProviderLabel(props.metadata.provider)} "{props.input.query}"{" "}
      <Show when={metadata().numResults}>({metadata().numResults} results)</Show>
    </InlineTool>
  )
}

export function Task(props: SessionToolProps<typeof TaskTool>) {
  const { theme } = useTheme()
  const { navigate } = useRoute()
  const sync = useSync()
  const dialog = useDialog()
  createEffect(() => {
    const sessionId = props.metadata.sessionId
    if (!sessionId) return
    onCleanup(sync.session.retain(sessionId))
    if (!sync.data.message[sessionId]?.length) void sync.session.sync(sessionId)
  })
  const messages = createMemo(() => sync.data.message[props.metadata.sessionId ?? ""] ?? [])
  const tools = createMemo(() => messages().flatMap((message) =>
    (sync.data.part[message.id] ?? [])
      .filter((part) => part.type === "tool")
      .map((part) => ({ tool: part.tool, state: part.state })),
  ))
  const current = createMemo(() => tools().map((item) => ({
    tool: item.tool,
    title: item.state.status === "running" || item.state.status === "completed" ? item.state.title : undefined,
  })).findLast((item) => item.title))
  const retry = createMemo(() => {
    const status = sync.data.session_status[props.metadata.sessionId ?? ""]
    return status?.type === "retry" ? status : undefined
  })
  const duration = createMemo(() => {
    const start = messages().find((message) => message.role === "user")?.time.created
    const end = messages().findLast((message) => message.role === "assistant")?.time.completed
    return start && end ? end - start : 0
  })
  const content = createMemo(() => {
    if (!props.input.description) return ""
    const description = props.metadata.background === true ? `${props.input.description} (background)` : props.input.description
    const lines = [`${Locale.titlecase(props.input.subagent_type ?? "General")} Task — ${description}`]
    if (props.part.state.status === "running" && retry()) {
      lines.push(`↳ ${Locale.truncate(retry()!.message, 80)} [retrying attempt #${retry()!.attempt}]`)
    }
    if (props.part.state.status === "running" && !retry() && tools().length > 0) {
      const item = current()
      lines.push(item ? `↳ ${Locale.titlecase(item.tool)} ${item.title}` : `↳ ${tools().length} toolcalls`)
    }
    if (props.part.state.status === "completed") {
      lines.push(props.metadata.background === true
        ? `└ ${tools().length} toolcalls`
        : `└ ${tools().length} toolcalls · ${Locale.duration(duration())}`)
    }
    return lines.join("\n")
  })
  return (
    <InlineTool
      icon="│"
      color={retry() ? theme.error : undefined}
      spinner={props.part.state.status === "running"}
      complete={props.input.description}
      pending="Delegating..."
      part={props.part}
      onClick={() => {
        if (props.metadata.sessionId) navigate({ type: "session", sessionID: props.metadata.sessionId })
        if (retry()) void DialogAlert.show(dialog, "Retry Error", retry()!.message)
      }}
    >
      {content()}
    </InlineTool>
  )
}

export function TodoWrite(props: SessionToolProps<typeof TodoWriteTool>) {
  return (
    <Switch>
      <Match when={props.metadata.todos?.length}>
        <BlockTool title="# Todos" part={props.part}>
          <box><For each={props.input.todos ?? []}>{(todo) => <TodoItem status={todo.status} content={todo.content} />}</For></box>
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="⚙" pending="Updating todos..." complete={false} part={props.part}>Updating todos...</InlineTool>
      </Match>
    </Switch>
  )
}

export function Question(props: SessionToolProps<typeof QuestionTool>) {
  const { theme } = useTheme()
  const count = createMemo(() => props.input.questions?.length ?? 0)
  const format = (answer?: ReadonlyArray<string>) => answer?.length ? answer.join(", ") : "(no answer)"
  return (
    <Switch>
      <Match when={props.metadata.answers}>
        <BlockTool title="# Questions" part={props.part}>
          <box gap={1}>
            <For each={props.input.questions ?? []}>{(question, index) => (
              <box flexDirection="column">
                <text fg={theme.textMuted}>{question.question}</text>
                <text fg={theme.text}>{format(props.metadata.answers?.[index()])}</text>
              </box>
            )}</For>
          </box>
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="→" pending="Asking questions..." complete={count()} part={props.part}>
          Asked {count()} question{count() === 1 ? "" : "s"}
        </InlineTool>
      </Match>
    </Switch>
  )
}

export function Skill(props: SessionToolProps<typeof SkillTool>) {
  return <InlineTool icon="→" pending="Loading skill..." complete={props.input.name} part={props.part}>Skill "{props.input.name}"</InlineTool>
}
