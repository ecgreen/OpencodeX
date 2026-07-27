import type { JSX } from "solid-js"
import { Show, splitProps } from "solid-js"
import { classes, type ControlTone } from "./shared"

export type ProgressMeterProps = Omit<JSX.HTMLAttributes<HTMLDivElement>, "title"> & {
  /** Completion from 0 to 1. Omit for an indeterminate meter. */
  value?: number
  label?: JSX.Element
  /** Right-aligned readout. Rendered with tabular numerals. */
  detail?: JSX.Element
  tone?: ControlTone | "special"
}

/**
 * Linear progress for context windows, token budgets, and swarm completion.
 * Indeterminate when `value` is undefined.
 */
export function ProgressMeter(props: ProgressMeterProps) {
  const [local, rest] = splitProps(props, ["value", "label", "detail", "tone", "class", "classList"])
  const indeterminate = () => local.value === undefined
  const ratio = () => Math.min(1, Math.max(0, local.value ?? 0))
  return (
    <div
      {...rest}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate() ? undefined : Math.round(ratio() * 100)}
      data-ui="meter"
      data-tone={local.tone ?? "accent"}
      data-indeterminate={indeterminate() ? "true" : undefined}
      class={classes("ui-meter", local.class)}
      classList={local.classList}
    >
      <Show when={local.label || local.detail}>
        <div class="ui-meter-head">
          <span class="ds-truncate">{local.label}</span>
          <Show when={local.detail}>{(detail) => <span class="ui-meter-value">{detail()}</span>}</Show>
        </div>
      </Show>
      <div class="ui-meter-track">
        <div class="ui-meter-fill" style={{ width: indeterminate() ? undefined : `${ratio() * 100}%` }} />
      </div>
    </div>
  )
}
