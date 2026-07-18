import { SelectV2, type SelectV2Props } from "@opencode-ai/ui/v2/components/select-v2"
import type { JSX } from "solid-js"
import { Show, splitProps } from "solid-js"
import type { ControlSize } from "./shared"

export type SelectProps<T> = Omit<SelectV2Props<T>, "appearance" | "invalid" | "value" | "label"> & {
  label?: JSX.Element
  optionValue?: (option: T) => string
  optionLabel?: (option: T) => string
  description?: JSX.Element
  error?: JSX.Element
  size?: Exclude<ControlSize, "prominent">
  loading?: boolean
  required?: boolean
}

export function Select<T>(props: SelectProps<T>) {
  const [local, rest] = splitProps(props, ["label", "optionValue", "optionLabel", "description", "error", "size", "loading", "required", "disabled", "class"])
  return (
    <div data-ui="field" data-invalid={local.error ? "true" : undefined} data-loading={local.loading ? "true" : undefined} class={local.class}>
      <Show when={local.label}><span class="ui-field-label">{local.label}<Show when={local.required}><span aria-hidden="true"> *</span></Show></span></Show>
      <SelectV2 {...rest} value={local.optionValue} label={local.optionLabel} class="ui-select" style={{ width: "100%" }} disabled={local.disabled || local.loading} invalid={!!local.error} appearance={local.size === "compact" ? "base" : "large"} />
      <Show when={local.error || local.description}>
        <div class="ui-field-message" aria-live="polite">
          <Show when={local.error} fallback={<span>{local.description}</span>}><span role="alert">{local.error}</span></Show>
        </div>
      </Show>
    </div>
  )
}
