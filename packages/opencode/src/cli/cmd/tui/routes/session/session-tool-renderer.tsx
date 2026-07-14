import type { AssistantMessage, ToolPart } from "@opencode-ai/sdk/v2"
import { createMemo, Match, Show, Switch } from "solid-js"
import { ShellID } from "@/tool/shell/id"
import { useSync } from "@tui/context/sync"
import { useSessionView } from "./session-view-context"
import { Question, Shell, Skill, Task, TodoWrite, WebFetch, WebSearch } from "./session-tool-actions"
import { GenericTool } from "./session-tool-core"
import { ApplyPatch, Edit, Glob, Grep, Read, Write } from "./session-tool-files"

export function SessionToolPart(props: { last: boolean; part: ToolPart; message: AssistantMessage }) {
  const context = useSessionView()
  const sync = useSync()
  const shouldHide = createMemo(() => !context.showDetails() && props.part.state.status === "completed")
  const tool = {
    get metadata() {
      return props.part.state.status === "pending" ? {} : (props.part.state.metadata ?? {})
    },
    get input() {
      return props.part.state.input ?? {}
    },
    get output() {
      return props.part.state.status === "completed" ? props.part.state.output : undefined
    },
    get permission() {
      return (sync.data.permission[props.message.sessionID] ?? []).find((permission) => permission.tool?.callID === props.part.callID)
    },
    get tool() {
      return props.part.tool
    },
    get part() {
      return props.part
    },
  }

  return (
    <Show when={!shouldHide()}>
      <Switch>
        <Match when={props.part.tool === ShellID.ToolID}><Shell {...tool} /></Match>
        <Match when={props.part.tool === "glob"}><Glob {...tool} /></Match>
        <Match when={props.part.tool === "read"}><Read {...tool} /></Match>
        <Match when={props.part.tool === "grep"}><Grep {...tool} /></Match>
        <Match when={props.part.tool === "webfetch"}><WebFetch {...tool} /></Match>
        <Match when={props.part.tool === "websearch"}><WebSearch {...tool} /></Match>
        <Match when={props.part.tool === "write"}><Write {...tool} /></Match>
        <Match when={props.part.tool === "edit"}><Edit {...tool} /></Match>
        <Match when={props.part.tool === "task"}><Task {...tool} /></Match>
        <Match when={props.part.tool === "apply_patch"}><ApplyPatch {...tool} /></Match>
        <Match when={props.part.tool === "todowrite"}><TodoWrite {...tool} /></Match>
        <Match when={props.part.tool === "question"}><Question {...tool} /></Match>
        <Match when={props.part.tool === "skill"}><Skill {...tool} /></Match>
        <Match when={true}><GenericTool {...tool} /></Match>
      </Switch>
    </Show>
  )
}
