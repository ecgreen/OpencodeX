import { RGBA, type KeyEvent, type Renderable } from "@opentui/core"
import type { ActiveKey } from "@opentui/keymap"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"

export const whichKeyCommand = {
  toggle: "which-key.toggle",
  toggleLayout: "which-key.layout.toggle",
  togglePending: "which-key.pending.toggle",
  groupPrevious: "which-key.group.previous",
  groupNext: "which-key.group.next",
  scrollUp: "which-key.scroll.up",
  scrollDown: "which-key.scroll.down",
  pageUp: "which-key.page.up",
  pageDown: "which-key.page.down",
  home: "which-key.home",
  end: "which-key.end",
} as const

export const WHICH_KEY_LAYER_PRIORITY = 900
export const WHICH_KEY_KV_LAYOUT = "which_key_layout"
export const WHICH_KEY_KV_PENDING_PREVIEW = "which_key_pending_preview"
export const WHICH_KEY_COLUMN_GAP = 4
export const WHICH_KEY_TAB_GAP = 3
export const WHICH_KEY_MIN_TAB_GAP = 1
export const WHICH_KEY_TAB_CONTENT_GAP = 1
export const WHICH_KEY_MAX_COLUMN_WIDTH = 44
export const WHICH_KEY_PANEL_HEIGHT_RATIO = 0.3
export const WHICH_KEY_MIN_PANEL_HEIGHT = 8
export const WHICH_KEY_MAX_PANEL_HEIGHT = 16
export const WHICH_KEY_PANEL_TOP_PADDING = 1
export const WHICH_KEY_FOOTER_HEIGHT = 1
export const WHICH_KEY_FOOTER_MARGIN = 1

export const whichKeyToggleCommands = [
  whichKeyCommand.toggle,
  whichKeyCommand.toggleLayout,
  whichKeyCommand.togglePending,
] as const
export const whichKeyScrollCommands = [
  whichKeyCommand.scrollUp,
  whichKeyCommand.scrollDown,
  whichKeyCommand.pageUp,
  whichKeyCommand.pageDown,
  whichKeyCommand.home,
  whichKeyCommand.end,
] as const
export const whichKeyPanelCommands = [
  whichKeyCommand.groupPrevious,
  whichKeyCommand.groupNext,
  ...whichKeyScrollCommands,
] as const

export type WhichKeyLayout = "dock" | "overlay"
export type WhichKeyColor = RGBA | string
export type WhichKeySkin = {
  panel: WhichKeyColor
  text: WhichKeyColor
  muted: WhichKeyColor
  subtle: WhichKeyColor
  key: WhichKeyColor
  accent: WhichKeyColor
  tab: WhichKeyColor
  tabText: WhichKeyColor
}
export type WhichKeyEntry = {
  type: "entry"
  key: string
  label: string
  group: string
  continues: boolean
}
export type WhichKeyGroup = { label: string; entries: WhichKeyEntry[] }
export type WhichKeyHeaderItem = { type: "tab"; group: WhichKeyGroup } | { type: "scroll" }
export type WhichKeyItem = WhichKeyEntry | { type: "group"; label: string }

export function whichKeyLayout(value: unknown): WhichKeyLayout {
  return value === "overlay" ? "overlay" : "dock"
}

export function whichKeySkin(api: TuiPluginApi): WhichKeySkin {
  return {
    panel: ink(api, "backgroundMenu", "#1c1c1c"),
    text: ink(api, "text", "#f0f0f0"),
    muted: ink(api, "textMuted", "#a5a5a5"),
    subtle: ink(api, "borderSubtle", "#6f6f6f"),
    key: ink(api, "warning", "#ffd75f"),
    accent: ink(api, "primary", "#5f87ff"),
    tab: ink(api, "primary", "#5f87ff"),
    tabText: ink(api, "selectedListItemText", "#ffffff"),
  }
}

export function activeKeyEntry(api: TuiPluginApi, active: ActiveKey<Renderable, KeyEvent>): WhichKeyEntry {
  const text = (value: unknown) => {
    if (typeof value !== "string") return undefined
    return value.trim() || undefined
  }
  const label = active.continues
    ? text(active.tokenName) ?? text(active.display) ?? "Unknown"
    : text(active.commandAttrs?.title) ?? text(active.bindingAttrs?.desc) ?? text(active.commandAttrs?.desc) ?? "Unknown"
  return {
    type: "entry",
    key: api.keys.formatSequence([{ stroke: active.stroke, display: active.display, tokenName: active.tokenName }]),
    label: active.continues ? `+${label}` : label,
    group: active.continues
      ? "System"
      : text(active.commandAttrs?.category) ?? text(active.bindingAttrs?.group) ?? "Unknown",
    continues: active.continues,
  }
}

export function groupWhichKeyEntries(entries: WhichKeyEntry[]): WhichKeyGroup[] {
  const groups = Map.groupBy(entries, (entry) => entry.group)
  return [...groups]
    .map(([label, values]) => ({
      label,
      entries: values.toSorted(
        (left, right) =>
          Number(right.continues) - Number(left.continues) ||
          left.label.localeCompare(right.label) ||
          left.key.localeCompare(right.key),
      ),
    }))
    .toSorted((left, right) => left.label.localeCompare(right.label))
}

function ink(api: TuiPluginApi, name: string, fallback: string): WhichKeyColor {
  const value = Reflect.get(api.theme.current, name)
  if (typeof value === "string" || value instanceof RGBA) return value
  return fallback
}
