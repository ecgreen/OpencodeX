import type { JSX } from "solid-js"
import { Show, splitProps } from "solid-js"
import { Button, type ButtonProps } from "./button"
import { classes, type ControlTone } from "./shared"

export type InlineNoticeProps = JSX.HTMLAttributes<HTMLDivElement> & {
  tone?: Exclude<ControlTone, "neutral" | "accent">
  title?: JSX.Element
}

export function InlineNotice(props: InlineNoticeProps) {
  const [local, rest] = splitProps(props, ["tone", "title", "class", "classList", "children"])
  return (
    <div {...rest} role={local.tone === "danger" ? "alert" : "status"} data-ui="notice" data-tone={local.tone ?? "info"} class={classes("ui-notice", local.class)} classList={local.classList}>
      <Show when={local.title}>{(title) => <strong>{title()}</strong>}</Show>
      <div>{local.children}</div>
    </div>
  )
}

type StateProps = JSX.HTMLAttributes<HTMLDivElement> & {
  title: JSX.Element
  description?: JSX.Element
  action?: JSX.Element
  actionLabel?: string
  actionProps?: ButtonProps
  compact?: boolean
}

function StateSurface(props: StateProps & { kind: "loading" | "empty" | "error" }) {
  const [local, rest] = splitProps(props, ["kind", "title", "description", "action", "actionLabel", "actionProps", "compact", "class", "classList", "children"])
  return (
    <div {...rest} data-ui="state" data-kind={local.kind} data-compact={local.compact ? "true" : undefined} class={classes("ui-state", local.class)} classList={local.classList} aria-busy={local.kind === "loading" ? "true" : undefined}>
      <Show when={local.kind === "loading"}><span class="ui-state-activity" aria-hidden="true" /></Show>
      <strong>{local.title}</strong>
      <Show when={local.description}>{(description) => <p>{description()}</p>}</Show>
      {local.children}
      <Show when={local.action} fallback={<Show when={local.actionLabel}>{(label) => <Button {...local.actionProps} appearance="solid" tone={local.kind === "error" ? "danger" : "accent"}>{label()}</Button>}</Show>}>
        {(action) => action()}
      </Show>
    </div>
  )
}

export function LoadingState(props: Omit<StateProps, "action" | "actionLabel" | "actionProps">) {
  return <StateSurface {...props} kind="loading" />
}

export function EmptyState(props: StateProps) {
  return <StateSurface {...props} kind="empty" />
}

export function ErrorState(props: StateProps) {
  return <StateSurface {...props} kind="error" />
}
