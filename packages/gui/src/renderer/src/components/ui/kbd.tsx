import type { JSX } from "solid-js"
import { For, Show, splitProps } from "solid-js"
import { classes } from "./shared"

const APPLE = typeof navigator !== "undefined" && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent)

const SYMBOLS: Record<string, string> = {
  mod: APPLE ? "⌘" : "Ctrl",
  cmd: "⌘",
  meta: APPLE ? "⌘" : "Win",
  ctrl: APPLE ? "⌃" : "Ctrl",
  control: APPLE ? "⌃" : "Ctrl",
  alt: APPLE ? "⌥" : "Alt",
  option: "⌥",
  shift: APPLE ? "⇧" : "Shift",
  enter: "↵",
  return: "↵",
  escape: "Esc",
  esc: "Esc",
  backspace: "⌫",
  delete: "Del",
  tab: "⇥",
  space: "Space",
  up: "↑",
  down: "↓",
  left: "←",
  right: "→",
}

/** Splits "ctrl+shift+p" into display-ready key labels. */
export function parseShortcut(shortcut: string) {
  return shortcut
    .split("+")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => SYMBOLS[part.toLowerCase()] ?? (part.length === 1 ? part.toUpperCase() : part))
}

export type KbdProps = JSX.HTMLAttributes<HTMLElement> & { keys: string; separator?: JSX.Element }

/** Renders a keyboard shortcut. Pass the raw binding, e.g. keys="mod+k". */
export function Kbd(props: KbdProps) {
  const [local, rest] = splitProps(props, ["keys", "separator", "class", "classList"])
  const parts = () => parseShortcut(local.keys)
  return (
    <span {...rest} data-ui="kbd-group" class={classes("ui-kbd-group", local.class)} classList={local.classList}>
      <For each={parts()}>
        {(part, index) => (
          <>
            <Show when={index() > 0 && local.separator}>{local.separator}</Show>
            <kbd class="ui-kbd">{part}</kbd>
          </>
        )}
      </For>
    </span>
  )
}
