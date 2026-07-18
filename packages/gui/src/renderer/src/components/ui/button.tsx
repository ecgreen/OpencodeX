import type { JSX } from "solid-js"
import { Show, splitProps } from "solid-js"
import { Icon } from "../icon"
import { classes, type ControlAppearance, type ControlSize, type ControlTone } from "./shared"

export type ButtonProps = JSX.ButtonHTMLAttributes<HTMLButtonElement> & {
  appearance?: ControlAppearance
  tone?: ControlTone
  size?: ControlSize
  icon?: string
  leadingIcon?: string
  trailingIcon?: string
  fullWidth?: boolean
  loading?: boolean
  selected?: boolean
  iconOnly?: boolean
}

export function resolveButtonStyle(props: Pick<ButtonProps, "appearance" | "tone" | "size" | "iconOnly">) {
  return {
    appearance: props.appearance ?? "solid",
    tone: props.tone ?? "neutral",
    size: props.size ?? "default",
    iconOnly: props.iconOnly === true,
  } as const
}

export function Button(props: ButtonProps) {
  const [local, rest] = splitProps(props, [
    "appearance", "tone", "size", "icon", "leadingIcon", "trailingIcon", "fullWidth", "loading", "selected", "iconOnly",
    "class", "classList", "children", "disabled", "aria-busy",
  ])
  const style = () => resolveButtonStyle(local)
  const leadingIcon = () => local.leadingIcon ?? local.icon
  return (
    <button
      type="button"
      {...rest}
      disabled={local.disabled || local.loading}
      aria-busy={local.loading || local["aria-busy"] ? "true" : undefined}
      aria-pressed={local.selected ?? rest["aria-pressed"]}
      data-ui="button"
      data-appearance={style().appearance}
      data-tone={style().tone}
      data-size={style().size}
      data-icon-only={style().iconOnly ? "true" : undefined}
      data-full-width={local.fullWidth ? "true" : undefined}
      data-loading={local.loading ? "true" : undefined}
      data-selected={local.selected ? "true" : undefined}
      class={classes("ui-button", local.class)}
      classList={local.classList}
    >
      <Show when={local.loading}><span class="ui-button-spinner" aria-hidden="true" /></Show>
      <Show when={!local.loading && leadingIcon()}>{(name) => <Icon name={name()} />}</Show>
      <Show when={local.children}>{local.children}</Show>
      <Show when={local.trailingIcon}>{(name) => <Icon name={name()} />}</Show>
    </button>
  )
}

export type IconButtonProps = Omit<ButtonProps, "children" | "size" | "leadingIcon" | "trailingIcon"> & {
  icon: string
  label: string
  tooltip?: string
  size?: ControlSize
  pressed?: boolean
}

export function IconButton(props: IconButtonProps) {
  const [local, rest] = splitProps(props, ["icon", "label", "tooltip", "size", "pressed", "class", "classList"])
  const size = () => local.size ?? "default"
  return (
    <Button
      {...rest}
      size={size()}
      iconOnly
      icon={local.icon}
      aria-label={local.label}
      title={local.tooltip ?? rest.title ?? local.label}
      selected={local.pressed}
      class={classes("ui-icon-button", local.class)}
      classList={local.classList}
      data-control-size={size()}
    />
  )
}
