import type { SessionMessageAssistantTool } from "@opencode-ai/sdk/v2"
import { TextAttributes, type BoxRenderable } from "@opentui/core"
import { useRenderer, type JSX } from "@opentui/solid"
import { Match, Show, Switch, createMemo, createSignal } from "solid-js"
import { SplitBorder } from "@tui/component/border"
import { Spinner } from "@tui/component/spinner"
import { useTheme } from "@tui/context/theme"

export function MissingData(props: { label: string; detail: string }) {
  const { theme } = useTheme()
  return (
    <box
      border={["left"]}
      customBorderChars={SplitBorder.customBorderChars}
      borderColor={theme.warning}
      backgroundColor={theme.backgroundPanel}
      paddingLeft={2}
      paddingTop={1}
      paddingBottom={1}
      marginTop={1}
      flexShrink={0}
    >
      <text fg={theme.text}>
        <span style={{ bg: theme.warning, fg: theme.background, bold: true }}> MISSING DATA </span> {props.label}
      </text>
      <text fg={theme.textMuted}>{props.detail}</text>
    </box>
  )
}
export function InlineTool(props: {
  icon: string
  complete: unknown
  pending: string
  spinner?: boolean
  children: JSX.Element
  part: SessionMessageAssistantTool
}) {
  const { theme } = useTheme()
  const renderer = useRenderer()
  const [margin, setMargin] = createSignal(0)
  const [hover, setHover] = createSignal(false)
  const [showError, setShowError] = createSignal(false)
  const error = createMemo(() => (props.part.state.status === "error" ? props.part.state.error.message : undefined))
  const complete = createMemo(() => !!props.complete)
  const denied = createMemo(() => {
    const message = error()
    if (!message) return false
    return (
      message.includes("QuestionRejectedError") ||
      message.includes("rejected permission") ||
      message.includes("specified a rule") ||
      message.includes("user dismissed")
    )
  })
  const fg = createMemo(() => {
    if (error()) return theme.error
    if (complete()) return theme.textMuted
    return theme.text
  })
  const attributes = createMemo(() => (denied() ? TextAttributes.STRIKETHROUGH : undefined))
  return (
    <box
      marginTop={margin()}
      paddingLeft={3}
      flexShrink={0}
      flexDirection="row"
      gap={1}
      backgroundColor={hover() && error() ? theme.backgroundMenu : undefined}
      onMouseOver={() => error() && setHover(true)}
      onMouseOut={() => setHover(false)}
      onMouseUp={() => {
        if (!error()) return
        if (renderer.getSelection()?.getSelectedText()) return
        setShowError((prev) => !prev)
      }}
      renderBefore={function () {
        const el = this as BoxRenderable
        const parent = el.parent
        if (!parent) return
        const previous = parent.getChildren()[parent.getChildren().indexOf(el) - 1]
        if (!previous) {
          setMargin(0)
          return
        }
        if (previous.id.startsWith("text")) setMargin(1)
      }}
    >
      <box flexShrink={0}>
        <Switch>
          <Match when={props.spinner}>
            <Spinner color={theme.text} />
          </Match>
          <Match when={complete()}>
            <text fg={fg()} attributes={attributes()}>
              {props.icon}
            </text>
          </Match>
          <Match when={true}>
            <text fg={fg()} attributes={attributes()}>
              ~
            </text>
          </Match>
        </Switch>
      </box>
      <box flexGrow={1}>
        <box>
          <Switch>
            <Match when={complete()}>
              <text fg={fg()} attributes={attributes()}>
                {props.children}
              </text>
            </Match>
            <Match when={true}>
              <text fg={fg()} attributes={attributes()}>
                {props.pending}
              </text>
            </Match>
          </Switch>
        </box>
        <Show when={showError() && error()}>
          <box>
            <text fg={theme.error}>{error()}</text>
          </box>
        </Show>
      </box>
    </box>
  )
}

export function BlockTool(props: {
  title: string
  children: JSX.Element
  part?: SessionMessageAssistantTool
  onClick?: () => void
  spinner?: boolean
}) {
  const { theme } = useTheme()
  const renderer = useRenderer()
  const [hover, setHover] = createSignal(false)
  const error = createMemo(() => (props.part?.state.status === "error" ? props.part.state.error.message : undefined))
  return (
    <box
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
      flexShrink={0}
    >
      <Show
        when={props.spinner}
        fallback={
          <text paddingLeft={3} fg={theme.textMuted}>
            {props.title}
          </text>
        }
      >
        <Spinner color={theme.textMuted}>{props.title.replace(/^# /, "")}</Spinner>
      </Show>
      {props.children}
      <Show when={error()}>
        <text fg={theme.error}>{error()}</text>
      </Show>
    </box>
  )
}
