import type { SessionMessageAssistantTool } from "@opencode-ai/sdk/v2"
import { useTerminalDimensions } from "@opentui/solid"
import { Match, Show, Switch, createMemo, createSignal } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { collapseToolOutput } from "../../util/collapse-tool-output"
import { ApplyPatch, Bash, Edit, Glob, Grep, Question, Read, Skill, Task, TodoWrite, WebFetch, WebSearch, Write } from "./session-v2-tool-renderers"
import { BlockTool, InlineTool } from "./session-v2-tool-primitives"
import { input, toolComplete, toolInputRecord, toolOutput, type ToolProps } from "./session-v2-tool-utils"

export function AssistantTool(props: { part: SessionMessageAssistantTool; sessionID: string }) {
  const input = createMemo(() => toolInputRecord(props.part.state.input))
  const toolprops = {
    get input() {
      return input()
    },
    get metadata() {
      return props.part.provider?.metadata ?? {}
    },
    get output() {
      return props.part.state.status === "pending" ? undefined : toolOutput(props.part.state.content)
    },
    sessionID: props.sessionID,
    part: props.part,
  }
  return (
    <Switch>
      <Match when={props.part.name === "bash"}>
        <Bash {...toolprops} />
      </Match>
      <Match when={props.part.name === "glob"}>
        <Glob {...toolprops} />
      </Match>
      <Match when={props.part.name === "read"}>
        <Read {...toolprops} />
      </Match>
      <Match when={props.part.name === "grep"}>
        <Grep {...toolprops} />
      </Match>
      <Match when={props.part.name === "webfetch"}>
        <WebFetch {...toolprops} />
      </Match>
      <Match when={props.part.name === "websearch"}>
        <WebSearch {...toolprops} />
      </Match>
      <Match when={props.part.name === "write"}>
        <Write {...toolprops} />
      </Match>
      <Match when={props.part.name === "edit"}>
        <Edit {...toolprops} />
      </Match>
      <Match when={props.part.name === "apply_patch"}>
        <ApplyPatch {...toolprops} />
      </Match>
      <Match when={props.part.name === "todowrite"}>
        <TodoWrite {...toolprops} />
      </Match>
      <Match when={props.part.name === "question"}>
        <Question {...toolprops} />
      </Match>
      <Match when={props.part.name === "skill"}>
        <Skill {...toolprops} />
      </Match>
      <Match when={props.part.name === "task"}>
        <Task {...toolprops} />
      </Match>
      <Match when={true}>
        <GenericTool {...toolprops} />
      </Match>
    </Switch>
  )
}

function GenericTool(props: ToolProps) {
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()
  const output = createMemo(() => props.output?.trim() ?? "")
  const [expanded, setExpanded] = createSignal(false)
  const maxLines = 3
  const maxChars = createMemo(() => maxLines * Math.max(20, dimensions().width - 6))
  const collapsed = createMemo(() => collapseToolOutput(output(), maxLines, maxChars()))
  const limited = createMemo(() => {
    if (expanded() || !collapsed().overflow) return output()
    return collapsed().output
  })
  return (
    <Show
      when={output()}
      fallback={
        <InlineTool icon="âš™" pending="Writing command..." complete={toolComplete(props.part)} part={props.part}>
          {props.part.name} {input(props.input)}
        </InlineTool>
      }
    >
      <BlockTool
        title={`# ${props.part.name} ${input(props.input)}`}
        part={props.part}
        onClick={collapsed().overflow ? () => setExpanded((prev) => !prev) : undefined}
      >
        <box gap={1}>
          <text fg={theme.text}>{limited()}</text>
          <Show when={collapsed().overflow}>
            <text fg={theme.textMuted}>{expanded() ? "Click to collapse" : "Click to expand"}</text>
          </Show>
        </box>
      </BlockTool>
    </Show>
  )
}
