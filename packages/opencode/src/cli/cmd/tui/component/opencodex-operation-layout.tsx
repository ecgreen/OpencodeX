import { TextAttributes } from "@opentui/core"
import { useKV } from "@tui/context/kv"
import { useTheme } from "@tui/context/theme"
import { createMemo, createSignal, Show, type JSX } from "solid-js"
import { Logo } from "./logo"

export function Section(props: {
  title: string
  count?: number
  required?: boolean
  collapsible?: boolean
  collapsed?: boolean
  selected?: boolean
  onSelect?: () => void
  onToggle?: () => void
  action?: { label: string; selected?: boolean; onSelect: () => void }
  children: JSX.Element
}) {
  const { theme } = useTheme()
  const [internalCollapsed, setInternalCollapsed] = createSignal(false)
  const collapsed = createMemo(() => props.collapsed ?? internalCollapsed())
  const toggle = () => {
    if (!props.collapsible) return
    props.onSelect?.()
    if (props.onToggle) {
      props.onToggle()
      return
    }
    setInternalCollapsed((value) => !value)
  }
  return (
    <box flexDirection="column" gap={1} paddingTop={1}>
      <box flexDirection="row" gap={1} backgroundColor={props.selected ? theme.backgroundPanel : undefined} onMouseUp={toggle}>
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          {props.collapsible ? `${collapsed() ? "[+] " : "[-] "}` : ""}
          {props.title}
          <Show when={props.required}><span style={{ fg: theme.error }}> *</span></Show>
        </text>
        <Show when={props.count !== undefined && props.count > 0}><text fg={theme.textMuted}>({props.count})</text></Show>
        <Show when={props.action}>
          {(action) => (
            <text
              attributes={action().selected ? TextAttributes.BOLD : undefined}
              bg={action().selected ? (theme.backgroundMenu ?? theme.backgroundElement) : undefined}
              fg={theme.primary}
              onMouseUp={(event: { stopPropagation(): void }) => {
                event.stopPropagation()
                action().onSelect()
              }}
            >
              {action().label}
            </text>
          )}
        </Show>
      </box>
      <Show when={!props.collapsible || !collapsed()}><box flexDirection="column" gap={0}>{props.children}</box></Show>
    </box>
  )
}

export function CardGrid(props: { children: JSX.Element }) {
  return <box flexDirection="row" flexWrap="wrap" gap={1}>{props.children}</box>
}

export function TopLogoNav(props: { label?: string; onSelect: () => void }) {
  const { theme } = useTheme()
  const kv = useKV()
  return (
    <box flexShrink={0} flexDirection="column" gap={0}>
      <box flexDirection="row" justifyContent="space-between">
        <box flexGrow={1} />
        <box flexShrink={0} alignItems="center" flexDirection="column">
          <Logo idle animate={kv.get("animations_enabled", true)} />
          <Show when={props.label}>
            <box width="100%" flexDirection="row" justifyContent="flex-end" paddingRight={3}>
              <text attributes={TextAttributes.BOLD} fg={theme.warning} onMouseUp={props.onSelect}>{props.label}</text>
            </box>
          </Show>
        </box>
        <box flexGrow={1} />
      </box>
    </box>
  )
}

export function EmptyRow(props: { text: string }) {
  const { theme } = useTheme()
  return <text fg={theme.textMuted}>{props.text}</text>
}
