/** @jsxImportSource @opentui/solid */
import { TextAttributes } from "@opentui/core"
import { Show, type JSX } from "solid-js"
import { selectedForeground, useTheme } from "@tui/context/theme"
import { Locale } from "@/util/locale"

export function DialogSelectOptionRow(props: {
  title: string
  description?: string
  active?: boolean
  current?: boolean
  footer?: JSX.Element | string
  gutter?: () => JSX.Element
}) {
  const themeState = useTheme()
  const foreground = selectedForeground(themeState.theme)
  return (
    <>
      <Show when={props.current}>
        <text
          flexShrink={0}
          fg={props.active ? foreground : props.current ? themeState.theme.primary : themeState.theme.text}
          marginRight={0}
        >
          ●
        </text>
      </Show>
      <Show when={!props.current && props.gutter}>
        <box flexShrink={0} marginRight={0}>
          {props.gutter?.()}
        </box>
      </Show>
      <text
        flexGrow={1}
        fg={props.active ? foreground : props.current ? themeState.theme.primary : themeState.theme.text}
        attributes={props.active ? TextAttributes.BOLD : undefined}
        overflow="hidden"
        wrapMode="none"
        paddingLeft={3}
      >
        {Locale.truncate(props.title, 61)}
        <Show when={props.description}>
          <span style={{ fg: props.active ? foreground : themeState.theme.textMuted }}> {props.description}</span>
        </Show>
      </text>
      <Show when={props.footer}>
        <box flexShrink={0}>
          <text fg={props.active ? foreground : themeState.theme.textMuted}>{props.footer}</text>
        </box>
      </Show>
    </>
  )
}
