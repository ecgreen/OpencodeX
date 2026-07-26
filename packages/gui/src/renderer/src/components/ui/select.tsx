import { Select as Kobalte } from "@kobalte/core/select"
import type { JSX } from "solid-js"
import { Show, createMemo, splitProps } from "solid-js"
import { Icon } from "../icon"
import { classes, type ControlSize } from "./shared"

type Group<T> = { category: string; options: T[] }

export type SelectProps<T> = {
  options: T[]
  /** Selected option. Single selection only. */
  current?: T
  onSelect?: (value: T | null) => void
  optionValue?: (option: T) => string
  optionLabel?: (option: T) => string
  optionDisabled?: (option: T) => boolean
  /** Secondary line under an option label. */
  optionDescription?: (option: T) => JSX.Element
  /** Right-aligned annotation on the option row. */
  optionMeta?: (option: T) => JSX.Element
  groupBy?: (option: T) => string
  label?: JSX.Element
  description?: JSX.Element
  error?: JSX.Element
  placeholder?: string
  size?: Exclude<ControlSize, "prominent">
  loading?: boolean
  required?: boolean
  disabled?: boolean
  class?: string
}

function group<T>(options: T[], groupBy?: (option: T) => string): Group<T>[] {
  if (!groupBy) return [{ category: "", options }]
  const map = new Map<string, T[]>()
  for (const option of options) {
    const key = groupBy(option)
    const existing = map.get(key)
    if (existing) existing.push(option)
    else map.set(key, [option])
  }
  return [...map.entries()].map(([category, items]) => ({ category, options: items }))
}

/**
 * The selection control. Owned by the design system rather than adapted from
 * the upstream library, whose stylesheet is unlayered and therefore outranks
 * every layered rule we could write against it.
 *
 * `Select` picks a value. Use `Menu` for actions; the two are never
 * interchangeable.
 */
export function Select<T>(props: SelectProps<T>) {
  const [local] = splitProps(props, [
    "options", "current", "onSelect", "optionValue", "optionLabel", "optionDisabled", "optionDescription",
    "optionMeta", "groupBy", "label", "description", "error", "placeholder", "size", "loading", "required",
    "disabled", "class",
  ])

  const groups = createMemo(() => group(local.options, local.groupBy))
  const labelOf = (option: T) => (local.optionLabel ? local.optionLabel(option) : String(option))
  const valueOf = (option: T) => (local.optionValue ? local.optionValue(option) : String(option))
  const detailed = () => Boolean(local.optionDescription || local.optionMeta)
  const disabled = () => local.disabled || local.loading

  return (
    <div data-ui="field" data-invalid={local.error ? "true" : undefined} data-loading={local.loading ? "true" : undefined} class={local.class}>
      <Show when={local.label}>
        <span class="ui-field-label">{local.label}<Show when={local.required}><span aria-hidden="true"> *</span></Show></span>
      </Show>
      <Kobalte<T, Group<T>>
        multiple={false}
        disabled={disabled()}
        value={local.current}
        options={groups()}
        optionValue={valueOf}
        optionTextValue={labelOf}
        optionDisabled={(option) => local.optionDisabled?.(option) ?? false}
        optionGroupChildren="options"
        placeholder={local.loading ? "Loading" : (local.placeholder ?? "Select an option")}
        /* Flush against the trigger: the panel and the trigger read as one
           control, joined by the trigger's bottom border. */
        gutter={0}
        sameWidth
        placement="bottom-start"
        onChange={(next) => local.onSelect?.((next ?? null) as T | null)}
        sectionComponent={(section) => (
          <Show when={section.section.rawValue.category}>
            <Kobalte.Section class="ui-select-group">{section.section.rawValue.category}</Kobalte.Section>
          </Show>
        )}
        itemComponent={(item) => (
          <Kobalte.Item item={item.item} class="ui-select-item" data-detailed={detailed() ? "true" : undefined}>
            <Kobalte.ItemLabel class="ui-select-item-body">
              <span class="ui-select-item-head">
                <span class="ui-select-item-label ds-truncate">{labelOf(item.item.rawValue)}</span>
                <Show when={local.optionMeta}>{(meta) => <span class="ui-select-item-meta">{meta()(item.item.rawValue)}</span>}</Show>
              </span>
              <Show when={local.optionDescription}>
                {(description) => <span class="ui-select-item-description">{description()(item.item.rawValue)}</span>}
              </Show>
            </Kobalte.ItemLabel>
            <Kobalte.ItemIndicator class="ui-select-item-check" forceMount>
              <Icon name="check" />
            </Kobalte.ItemIndicator>
          </Kobalte.Item>
        )}
      >
        <Kobalte.Trigger class="ui-select" data-size={local.size ?? "default"} data-invalid={local.error ? "true" : undefined}>
          <Kobalte.Value<T> class="ui-select-value ds-truncate">
            {(state) => {
              // Guard the empty selection: callers' optionLabel assumes an option.
              const option = state.selectedOption()
              return option == null ? "" : labelOf(option)
            }}
          </Kobalte.Value>
          <Show when={local.loading}><span class="ui-field-spinner" aria-hidden="true" /></Show>
          <Kobalte.Icon class="ui-select-chevron"><Icon name="chevronDown" /></Kobalte.Icon>
        </Kobalte.Trigger>
        <Kobalte.Portal>
          <Kobalte.Content class="ui-select-content">
            <Kobalte.Listbox class="ui-select-listbox" data-detailed={detailed() ? "true" : undefined} />
          </Kobalte.Content>
        </Kobalte.Portal>
      </Kobalte>
      <Show when={local.error || local.description}>
        <div class="ui-field-message" aria-live="polite">
          <Show when={local.error} fallback={<span>{local.description}</span>}><span role="alert">{local.error}</span></Show>
        </div>
      </Show>
    </div>
  )
}
