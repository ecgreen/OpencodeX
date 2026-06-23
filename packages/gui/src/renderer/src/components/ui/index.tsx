import type { JSX } from "solid-js"
import { Show, splitProps } from "solid-js"
import { Icon } from "../icon"

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "quiet"
type ButtonSize = "sm" | "md" | "lg" | "icon"

function classes(...values: Array<string | undefined | false>) {
  return values.filter((value): value is string => typeof value === "string" && value.length > 0).join(" ")
}

export type ButtonProps = JSX.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: string
}

export function Button(props: ButtonProps) {
  const [local, rest] = splitProps(props, ["variant", "size", "icon", "class", "classList", "children"])
  return (
    <button
      type="button"
      {...rest}
      data-ui="button"
      data-variant={local.variant ?? "secondary"}
      data-size={local.size ?? "md"}
      class={classes("ui-button", local.class)}
      classList={local.classList}
    >
      <Show when={local.icon}>
        {(icon) => <Icon name={icon()} />}
      </Show>
      <Show when={local.children}>{local.children}</Show>
    </button>
  )
}

export type IconButtonProps = Omit<ButtonProps, "children" | "size"> & {
  icon: string
  label: string
  size?: "sm" | "md" | "lg"
  pressed?: boolean
}

export function IconButton(props: IconButtonProps) {
  const [local, rest] = splitProps(props, ["icon", "label", "size", "pressed", "class", "classList"])
  return (
    <Button
      {...rest}
      size="icon"
      aria-label={local.label}
      title={rest.title ?? local.label}
      aria-pressed={local.pressed}
      class={classes("ui-icon-button", local.class)}
      classList={local.classList}
      data-icon-size={local.size ?? "md"}
    >
      <Icon name={local.icon} />
    </Button>
  )
}

export type SurfaceCardProps = JSX.HTMLAttributes<HTMLElement> & {
  tone?: "neutral" | "primary" | "info" | "warning" | "danger" | "success"
  interactive?: boolean
}

export function SurfaceCard(props: SurfaceCardProps) {
  const [local, rest] = splitProps(props, ["tone", "interactive", "class", "classList", "children"])
  return (
    <article
      {...rest}
      data-ui="card"
      data-tone={local.tone ?? "neutral"}
      data-interactive={local.interactive ? "true" : undefined}
      class={classes("ui-card", local.class)}
      classList={local.classList}
    >
      {local.children}
    </article>
  )
}

export function StatusBadge(props: JSX.HTMLAttributes<HTMLSpanElement> & { status: string }) {
  const [local, rest] = splitProps(props, ["status", "class", "classList", "children"])
  return (
    <span
      {...rest}
      data-ui="status"
      data-status={local.status.replaceAll("_", "-").replaceAll(" ", "-")}
      class={classes("ui-status", local.class)}
      classList={local.classList}
    >
      {local.children ?? local.status}
    </span>
  )
}

export function TextInput(props: JSX.InputHTMLAttributes<HTMLInputElement>) {
  const [local, rest] = splitProps(props, ["class", "classList"])
  return <input {...rest} data-ui="input" class={classes("ui-input", local.class)} classList={local.classList} />
}

export function TextArea(props: JSX.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const [local, rest] = splitProps(props, ["class", "classList"])
  return <textarea {...rest} data-ui="textarea" class={classes("ui-textarea", local.class)} classList={local.classList} />
}

export function Separator(props: JSX.HTMLAttributes<HTMLHRElement>) {
  const [local, rest] = splitProps(props, ["class", "classList"])
  return <hr {...rest} data-ui="separator" class={classes("ui-separator", local.class)} classList={local.classList} />
}

export function CommandRow(props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { shortcut?: string }) {
  const [local, rest] = splitProps(props, ["shortcut", "class", "classList", "children"])
  return (
    <button {...rest} type="button" data-ui="command-row" class={classes("ui-command-row", local.class)} classList={local.classList}>
      <span>{local.children}</span>
      <Show when={local.shortcut}>
        {(shortcut) => <kbd>{shortcut()}</kbd>}
      </Show>
    </button>
  )
}
