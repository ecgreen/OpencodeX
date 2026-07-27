import type { JSX } from "solid-js"
import { For, Show, splitProps } from "solid-js"
import { Icon } from "../icon"
import { classes } from "./shared"

export type TabItem<T extends string = string> = {
  value: T
  label: JSX.Element
  icon?: string
  count?: number
  disabled?: boolean
}

export type TabsProps<T extends string = string> = Omit<JSX.HTMLAttributes<HTMLDivElement>, "onChange"> & {
  items: TabItem<T>[]
  value: T
  onChange: (value: T) => void
  /** `underline` for panel and page navigation, `segmented` for exclusive value pickers. */
  appearance?: "underline" | "segmented"
  label?: string
}

/**
 * One tab pattern, two skins. Keyboard: arrows move selection, Home/End jump.
 */
export function Tabs<T extends string = string>(props: TabsProps<T>) {
  const [local, rest] = splitProps(props, ["items", "value", "onChange", "appearance", "label", "class", "classList"])
  const enabled = () => local.items.filter((item) => !item.disabled)

  const move = (offset: number) => {
    const list = enabled()
    const index = list.findIndex((item) => item.value === local.value)
    const next = list[(index + offset + list.length) % list.length]
    if (next) local.onChange(next.value)
  }

  const onKeyDown: JSX.EventHandler<HTMLDivElement, KeyboardEvent> = (event) => {
    const actions: Record<string, () => void> = {
      ArrowRight: () => move(1),
      ArrowDown: () => move(1),
      ArrowLeft: () => move(-1),
      ArrowUp: () => move(-1),
      Home: () => enabled()[0] && local.onChange(enabled()[0].value),
      End: () => enabled().at(-1) && local.onChange(enabled().at(-1)!.value),
    }
    const action = actions[event.key]
    if (!action) return
    event.preventDefault()
    action()
  }

  return (
    <div
      {...rest}
      role="tablist"
      aria-label={local.label}
      data-ui="tabs"
      data-appearance={local.appearance ?? "underline"}
      class={classes("ui-tabs", local.class)}
      classList={local.classList}
      onKeyDown={onKeyDown}
    >
      <For each={local.items}>
        {(item) => (
          <button
            type="button"
            role="tab"
            class="ui-tab"
            disabled={item.disabled}
            aria-selected={item.value === local.value}
            tabIndex={item.value === local.value ? 0 : -1}
            onClick={() => local.onChange(item.value)}
          >
            <Show when={item.icon}>{(name) => <Icon name={name()} />}</Show>
            <span>{item.label}</span>
            <Show when={item.count !== undefined}>
              <span class="ui-tab-count">{item.count}</span>
            </Show>
          </button>
        )}
      </For>
    </div>
  )
}

/** Exclusive value picker. Same engine as Tabs, segmented presentation. */
export function SegmentedControl<T extends string = string>(props: Omit<TabsProps<T>, "appearance">) {
  return <Tabs {...props} appearance="segmented" />
}
