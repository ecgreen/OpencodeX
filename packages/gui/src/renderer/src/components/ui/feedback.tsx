import { MenuV2 } from "@opencode-ai/ui/v2/components/menu-v2"
import type { JSX } from "solid-js"
import { Show, splitProps } from "solid-js"
import { classes, type ControlTone } from "./shared"

export type SurfaceCardProps = JSX.HTMLAttributes<HTMLElement> & { tone?: ControlTone; interactive?: boolean }

export function SurfaceCard(props: SurfaceCardProps) {
  const [local, rest] = splitProps(props, ["tone", "interactive", "class", "classList", "children"])
  return <article {...rest} data-ui="card" data-tone={local.tone ?? "neutral"} data-interactive={local.interactive ? "true" : undefined} class={classes("ui-card", local.class)} classList={local.classList}>{local.children}</article>
}

export function StatusBadge(props: JSX.HTMLAttributes<HTMLSpanElement> & { status: string }) {
  const [local, rest] = splitProps(props, ["status", "class", "classList", "children"])
  return <span {...rest} data-ui="status" data-status={local.status.replaceAll("_", "-").replaceAll(" ", "-")} class={classes("ui-status", local.class)} classList={local.classList}>{local.children ?? local.status}</span>
}

export function Separator(props: JSX.HTMLAttributes<HTMLHRElement>) {
  const [local, rest] = splitProps(props, ["class", "classList"])
  return <hr {...rest} data-ui="separator" class={classes("ui-separator", local.class)} classList={local.classList} />
}

export function CommandRow(props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { shortcut?: string }) {
  const [local, rest] = splitProps(props, ["shortcut", "class", "classList", "children"])
  return <button {...rest} type="button" data-ui="command-row" class={classes("ui-command-row", local.class)} classList={local.classList}><span>{local.children}</span><Show when={local.shortcut}>{(shortcut) => <kbd>{shortcut()}</kbd>}</Show></button>
}

export const Menu = MenuV2
export const DropdownMenu = MenuV2
