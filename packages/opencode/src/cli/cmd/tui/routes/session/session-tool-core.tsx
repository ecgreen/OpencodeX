import type { ToolPart } from "@opencode-ai/sdk/v2"
import { BoxRenderable, RGBA, TextAttributes } from "@opentui/core"
import { useRenderer, type JSX } from "@opentui/solid"
import { createMemo, createSignal, Match, Show, Switch } from "solid-js"
import { SplitBorder } from "@tui/component/border"
import { Spinner } from "@tui/component/spinner"
import { useSync } from "@tui/context/sync"
import { useTheme } from "@tui/context/theme"
import { collapseToolOutput } from "@tui/util/collapse-tool-output"
import { useSessionView } from "./session-view-context"
import { formatToolInput } from "./session-tool-types"

const INLINE_TOOL_ICON_WIDTH = 2

export function GenericTool(props: {
  input: Record<string, unknown>
  output?: string
  tool: string
  part: ToolPart
}) {
  const { theme } = useTheme()
  const context = useSessionView()
  const output = createMemo(() => props.output?.trim() ?? "")
  const [expanded, setExpanded] = createSignal(false)
  const collapsed = createMemo(() => collapseToolOutput(output(), 3, 3 * Math.max(20, context.width - 6)))
  const limited = createMemo(() => expanded() || !collapsed().overflow ? output() : collapsed().output)
  return (
    <Show
      when={props.output && context.showGenericToolOutput()}
      fallback={
        <InlineTool icon="⚙" pending="Writing command..." complete={true} part={props.part}>
          {props.tool} {formatToolInput(props.input)}
        </InlineTool>
      }
    >
      <BlockTool
        title={`# ${props.tool} ${formatToolInput(props.input)}`}
        part={props.part}
        onClick={collapsed().overflow ? () => setExpanded((value) => !value) : undefined}
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

export function InlineTool(props: {
  icon: string
  iconColor?: RGBA
  color?: RGBA
  complete: unknown
  pending: string
  spinner?: boolean
  children: JSX.Element
  part: ToolPart
  onClick?: () => void
}) {
  const { theme } = useTheme()
  const context = useSessionView()
  const sync = useSync()
  const renderer = useRenderer()
  const [hover, setHover] = createSignal(false)
  const [errorExpanded, setErrorExpanded] = createSignal(false)
  const permission = createMemo(() => sync.data.permission[context.sessionID]?.at(0)?.tool?.callID === props.part.callID)
  const error = createMemo(() => props.part.state.status === "error" ? props.part.state.error : undefined)
  const denied = createMemo(() => ["QuestionRejectedError", "rejected permission", "specified a rule", "user dismissed"]
    .some((message) => error()?.includes(message)))
  const failed = createMemo(() => Boolean(error() && !denied()))
  const clickable = createMemo(() => Boolean(props.onClick || failed()))
  const color = createMemo(() => {
    if (props.color) return props.color
    if (permission()) return theme.warning
    if (failed()) return theme.error
    if (hover() && props.onClick) return theme.text
    return props.complete ? theme.textMuted : theme.text
  })

  return (
    <InlineToolRow
      icon={props.icon}
      iconColor={props.iconColor}
      color={color()}
      errorColor={theme.error}
      failed={failed()}
      denied={Boolean(denied())}
      error={error()}
      errorExpanded={errorExpanded()}
      complete={props.complete}
      pending={props.pending}
      spinner={props.spinner}
      separateAfter={(id) => sync.data.message[context.sessionID]?.some((message) => message.role === "user" && message.id === id) ?? false}
      onMouseOver={() => clickable() && setHover(true)}
      onMouseOut={() => setHover(false)}
      onMouseUp={() => {
        if (renderer.getSelection()?.getSelectedText()) return
        if (failed()) return setErrorExpanded((value) => !value)
        props.onClick?.()
      }}
    >
      {props.children}
    </InlineToolRow>
  )
}

export function InlineToolRow(props: {
  icon: string
  iconColor?: RGBA
  color?: RGBA
  errorColor?: RGBA
  failed?: boolean
  denied?: boolean
  error?: string
  errorExpanded?: boolean
  complete: unknown
  pending: string
  spinner?: boolean
  children: JSX.Element
  separateAfter?: (id: string | undefined) => boolean
  onMouseOver?: () => void
  onMouseOut?: () => void
  onMouseUp?: () => void
}) {
  const [margin, setMargin] = createSignal(0)
  return (
    <box
      marginTop={margin()}
      paddingLeft={3}
      onMouseOver={props.onMouseOver}
      onMouseOut={props.onMouseOut}
      onMouseUp={props.onMouseUp}
      renderBefore={function () {
        const element = this as BoxRenderable
        const parent = element.parent
        if (!parent) return
        const children = parent.getChildren()
        const previous = children[children.indexOf(element) - 1]
        setMargin(previous?.id.startsWith("text-") || previous?.id.startsWith("tool-block-") || props.separateAfter?.(previous?.id) ? 1 : 0)
      }}
    >
      <Switch>
        <Match when={props.spinner}><Spinner color={props.color} children={props.children} /></Match>
        <Match when={true}>
          <Show
            when={Boolean(props.complete)}
            fallback={<text paddingLeft={3} fg={props.color} attributes={props.denied ? TextAttributes.STRIKETHROUGH : undefined}>~ {props.pending}</text>}
          >
            <box flexDirection="row">
              <text width={INLINE_TOOL_ICON_WIDTH} fg={props.failed ? props.errorColor : (props.iconColor ?? props.color)} attributes={props.denied ? TextAttributes.STRIKETHROUGH : undefined}>{props.icon}</text>
              <text flexGrow={1} fg={props.failed ? props.errorColor : props.color} attributes={props.denied ? TextAttributes.STRIKETHROUGH : undefined}>{props.children}</text>
            </box>
          </Show>
        </Match>
      </Switch>
      <Show when={props.failed && props.errorExpanded}>
        <box paddingLeft={INLINE_TOOL_ICON_WIDTH}><text fg={props.errorColor}>{props.error}</text></box>
      </Show>
    </box>
  )
}

export function BlockTool(props: { title: string; children: JSX.Element; onClick?: () => void; part?: ToolPart; spinner?: boolean }) {
  const { theme } = useTheme()
  const renderer = useRenderer()
  const [hover, setHover] = createSignal(false)
  const error = createMemo(() => props.part?.state.status === "error" ? props.part.state.error : undefined)
  return (
    <box
      id={props.part ? "tool-block-" + props.part.id : undefined}
      border={["left"]}
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      marginTop={1}
      gap={1}
      backgroundColor={hover() ? theme.backgroundMenu : theme.backgroundPanel}
      customBorderChars={SplitBorder.customBorderChars}
      borderColor={theme.background}
      onMouseOver={() => props.onClick && setHover(true)}
      onMouseOut={() => setHover(false)}
      onMouseUp={() => {
        if (renderer.getSelection()?.getSelectedText()) return
        props.onClick?.()
      }}
    >
      <Show when={props.spinner} fallback={<text paddingLeft={3} fg={theme.textMuted}>{props.title}</text>}>
        <Spinner color={theme.textMuted}>{props.title.replace(/^# /, "")}</Spinner>
      </Show>
      {props.children}
      <Show when={error()}><text fg={theme.error}>{error()}</text></Show>
    </box>
  )
}
