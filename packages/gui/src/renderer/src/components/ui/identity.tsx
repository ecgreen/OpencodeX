import type { JSX } from "solid-js"
import { Show, splitProps } from "solid-js"
import { classes } from "./shared"

/** Palette slots an identity glyph can land in. Deterministic, never random. */
const IDENTITY_SLOTS = ["accent", "info", "success", "warning", "danger", "special"] as const

export type IdentitySlot = (typeof IDENTITY_SLOTS)[number]

/** Stable hash so the same agent, model, or role always gets the same color. */
export function identitySlot(seed: string): IdentitySlot {
  let hash = 0
  for (let index = 0; index < seed.length; index++) hash = (hash * 31 + seed.charCodeAt(index)) | 0
  return IDENTITY_SLOTS[Math.abs(hash) % IDENTITY_SLOTS.length]
}

/** Up to two characters, skipping separators, for the glyph face. */
export function identityInitials(name: string) {
  const words = name.split(/[\s\-_/.]+/).filter((word) => /[a-z0-9]/i.test(word))
  if (words.length === 0) return "?"
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

export type AgentGlyphProps = JSX.HTMLAttributes<HTMLSpanElement> & {
  /** Agent, model, or role name. Drives both the initials and the color. */
  name: string
  size?: "compact" | "default" | "prominent"
}

/** One identity system for agents, models, and swarm roles. */
export function AgentGlyph(props: AgentGlyphProps) {
  const [local, rest] = splitProps(props, ["name", "size", "class", "classList"])
  return (
    <span
      {...rest}
      aria-hidden="true"
      data-ui="glyph"
      data-tone={identitySlot(local.name)}
      data-size={local.size ?? "default"}
      class={classes("ui-glyph", local.class)}
      classList={local.classList}
    >
      {identityInitials(local.name)}
    </span>
  )
}

export type ModelBadgeProps = JSX.HTMLAttributes<HTMLSpanElement> & {
  model: string
  provider?: string
  /** Agent mode or variant, e.g. "build", "plan". */
  variant?: string
}

/** Compact provider/model/variant grammar, identical on every surface. */
export function ModelBadge(props: ModelBadgeProps) {
  const [local, rest] = splitProps(props, ["model", "provider", "variant", "class", "classList"])
  return (
    <span {...rest} data-ui="model" class={classes("ui-model", local.class)} classList={local.classList}>
      <Show when={local.provider}>{(provider) => <span class="ui-model-provider">{provider()}</span>}</Show>
      <span class="ui-model-name ds-truncate">{local.model}</span>
      <Show when={local.variant}>{(variant) => <span class="ui-model-variant">{variant()}</span>}</Show>
    </span>
  )
}
