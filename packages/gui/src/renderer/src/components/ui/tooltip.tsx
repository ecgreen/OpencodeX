import { TooltipV2 } from "@opencode-ai/ui/v2/components/tooltip-v2"
import type { JSX } from "solid-js"
import { Show } from "solid-js"
import { Kbd } from "./kbd"
import { classes } from "./shared"

export type TooltipProps = {
  /** Tooltip body. Keep it to a short phrase; it is not a place for instructions. */
  label: JSX.Element
  /** Optional shortcut binding rendered as keycaps, e.g. "mod+k". */
  shortcut?: string
  placement?: "top" | "bottom" | "left" | "right"
  /** Skip the tooltip without unmounting the trigger. */
  disabled?: boolean
  class?: string
  children: JSX.Element
}

/**
 * The single tooltip surface. Never use the native `title` attribute on an
 * interactive control: it is unstyled, slow, and invisible to touch and keyboard.
 */
export function Tooltip(props: TooltipProps) {
  return (
    <TooltipV2
      inactive={props.disabled}
      placement={props.placement ?? "top"}
      class={classes("ui-tooltip-trigger", props.class)}
      contentClass="ui-tooltip"
      value={
        <>
          <span class="ui-tooltip-label">{props.label}</span>
          <Show when={props.shortcut}>{(shortcut) => <Kbd keys={shortcut()} />}</Show>
        </>
      }
    >
      {props.children}
    </TooltipV2>
  )
}
