import { MenuV2 } from "@opencode-ai/ui/v2/components/menu-v2"
import type { JSX } from "solid-js"
import { Show, splitProps } from "solid-js"
import { statusPresentation } from "../../lib/status-system"
import { classes, type ControlTone } from "./shared"

export type SurfaceCardProps = JSX.HTMLAttributes<HTMLElement> & { tone?: ControlTone; interactive?: boolean }

export function SurfaceCard(props: SurfaceCardProps) {
  const [local, rest] = splitProps(props, ["tone", "interactive", "class", "classList", "children"])
  return <article {...rest} data-ui="card" data-tone={local.tone ?? "neutral"} data-interactive={local.interactive ? "true" : undefined} class={classes("ui-card", local.class)} classList={local.classList}>{local.children}</article>
}

export type StatusBadgeProps = JSX.HTMLAttributes<HTMLSpanElement> & {
  status: string
  /** Overrides the tone resolved from the status table. */
  tone?: ControlTone | "special"
  appearance?: "soft" | "outline" | "solid" | "bare"
  /** Hide the leading dot when the surrounding row already carries the signal. */
  dot?: boolean
}

/**
 * Status label. Tone, glyph, and default text all resolve from lib/status-system
 * so one status reads identically everywhere it appears.
 */
export function StatusBadge(props: StatusBadgeProps) {
  const [local, rest] = splitProps(props, ["status", "tone", "appearance", "dot", "class", "classList", "children"])
  const presentation = () => statusPresentation(local.status)
  return (
    <span
      {...rest}
      data-ui="status"
      data-status={statusKey(local.status)}
      data-tone={local.tone ?? presentation().tone}
      data-appearance={local.appearance ?? "soft"}
      data-pulse={presentation().active ? "true" : undefined}
      class={classes("ui-status", local.class)}
      classList={local.classList}
    >
      <Show when={local.dot !== false}><span class="ui-status-dot" aria-hidden="true" /></Show>
      <span class="ui-status-label">{local.children ?? presentation().label}</span>
    </span>
  )
}

export type CountBadgeProps = JSX.HTMLAttributes<HTMLSpanElement> & {
  count: number
  tone?: ControlTone | "special"
  /** Values above this render as "max+". */
  max?: number
}

/** Numeric counter. Never let one change the geometry of its container. */
export function CountBadge(props: CountBadgeProps) {
  const [local, rest] = splitProps(props, ["count", "tone", "max", "class", "classList"])
  const max = () => local.max ?? 99
  return (
    <span {...rest} data-ui="count" data-tone={local.tone ?? "neutral"} class={classes("ui-count", local.class)} classList={local.classList}>
      {local.count > max() ? `${max()}+` : local.count}
    </span>
  )
}

export function Separator(props: JSX.HTMLAttributes<HTMLHRElement> & { orientation?: "horizontal" | "vertical" }) {
  const [local, rest] = splitProps(props, ["orientation", "class", "classList"])
  return <hr {...rest} data-ui="separator" data-orientation={local.orientation ?? "horizontal"} class={classes("ui-separator", local.class)} classList={local.classList} />
}

export function CommandRow(props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { shortcut?: string }) {
  const [local, rest] = splitProps(props, ["shortcut", "class", "classList", "children"])
  return <button {...rest} type="button" data-ui="command-row" class={classes("ui-command-row", local.class)} classList={local.classList}><span>{local.children}</span><Show when={local.shortcut}>{(shortcut) => <kbd class="ui-kbd">{shortcut()}</kbd>}</Show></button>
}

function statusKey(status: string) {
  return status.replaceAll("_", "-").replaceAll(" ", "-")
}

export const Menu = MenuV2
export const DropdownMenu = MenuV2
