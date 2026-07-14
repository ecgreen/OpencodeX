import { useTerminalDimensions } from "@opentui/solid"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { createEffect, createMemo, createSignal } from "solid-js"
import { useBindings, useKeymapSelector } from "../../keymap"
import {
  activeKeyEntry,
  groupWhichKeyEntries,
  whichKeyCommand,
  whichKeyPanelCommands,
  whichKeyScrollCommands,
  whichKeySkin,
  WHICH_KEY_COLUMN_GAP,
  WHICH_KEY_FOOTER_HEIGHT,
  WHICH_KEY_FOOTER_MARGIN,
  WHICH_KEY_MAX_COLUMN_WIDTH,
  WHICH_KEY_MAX_PANEL_HEIGHT,
  WHICH_KEY_MIN_PANEL_HEIGHT,
  WHICH_KEY_MIN_TAB_GAP,
  WHICH_KEY_PANEL_HEIGHT_RATIO,
  WHICH_KEY_PANEL_TOP_PADDING,
  WHICH_KEY_TAB_CONTENT_GAP,
  WHICH_KEY_TAB_GAP,
  type WhichKeyHeaderItem,
  type WhichKeyItem,
  type WhichKeyLayout,
} from "./which-key-model"

export function useWhichKeyShortcut(api: TuiPluginApi, name: string) {
  return useKeymapSelector((keymap) =>
    api.keys.formatSequence(
      keymap.getCommandBindings({ visibility: "registered", commands: [name] }).get(name)?.[0]?.sequence,
    ),
  )
}

export function createWhichKeyController(props: {
  api: TuiPluginApi
  mode: () => WhichKeyLayout
  pendingPreview: () => boolean
  pinned: () => boolean
}) {
  const dimensions = useTerminalDimensions()
  const [offset, setOffset] = createSignal(0)
  const [activeGroup, setActiveGroup] = createSignal<string | undefined>()
  const pending = useKeymapSelector((keymap) => keymap.getPendingSequence())
  const active = useKeymapSelector((keymap) => keymap.getActiveKeys({ includeMetadata: true }))
  const pendingActive = createMemo(() => pending().length > 0 && active().length > 0)
  const visible = createMemo(
    () => props.pinned() || (props.mode() === "overlay" && props.pendingPreview() && pendingActive()),
  )
  const pendingMode = createMemo(() => visible() && pendingActive())
  const width = createMemo(() => Math.max(1, dimensions().width))
  const panelHeight = createMemo(() =>
    Math.max(
      WHICH_KEY_MIN_PANEL_HEIGHT,
      Math.min(WHICH_KEY_MAX_PANEL_HEIGHT, Math.floor(dimensions().height * WHICH_KEY_PANEL_HEIGHT_RATIO)),
    ),
  )
  const contentWidth = createMemo(() => Math.max(1, width() - 2))
  const columns = createMemo(() =>
    Math.max(
      1,
      Math.min(
        3,
        Math.floor((contentWidth() + WHICH_KEY_COLUMN_GAP) / (WHICH_KEY_MAX_COLUMN_WIDTH + WHICH_KEY_COLUMN_GAP)) || 1,
      ),
    ),
  )
  const groups = createMemo(() => groupWhichKeyEntries(active().map((item) => activeKeyEntry(props.api, item))))
  const tabsVisible = createMemo(() => !pendingMode() && groups().length > 0)
  const headerVisible = createMemo(() => tabsVisible() || pendingMode())
  const footerVisible = createMemo(() => !pendingMode())
  const rows = createMemo(() =>
    Math.max(
      1,
      panelHeight() -
        WHICH_KEY_PANEL_TOP_PADDING -
        (headerVisible() ? 1 : 0) -
        (tabsVisible() ? WHICH_KEY_TAB_CONTENT_GAP : 0) -
        (footerVisible() ? WHICH_KEY_FOOTER_MARGIN + WHICH_KEY_FOOTER_HEIGHT : 0),
    ),
  )
  const pageSize = createMemo(() => rows() * columns())
  const currentGroup = createMemo(() =>
    groups().find((group) => group.label === activeGroup()) ?? groups()[0],
  )
  const items = createMemo<WhichKeyItem[]>(() => {
    if (!pendingMode()) return currentGroup()?.entries ?? []
    return groups().flatMap((group) => [{ type: "group" as const, label: group.label }, ...group.entries])
  })
  const maxOffset = createMemo(() => Math.max(0, items().length - pageSize()))
  const shown = createMemo(() => {
    const page = items().slice(offset(), offset() + pageSize())
    return Array.from({ length: columns() }, (_, column) => page.slice(column * rows(), (column + 1) * rows())).filter(
      (column) => column.length,
    )
  })
  const rowIndexes = createMemo(() => Array.from({ length: rows() }, (_, index) => index))
  const scrollable = createMemo(() => maxOffset() > 0)
  const headerItems = createMemo<WhichKeyHeaderItem[]>(() => [
    ...(tabsVisible() ? groups().map((group) => ({ type: "tab" as const, group })) : []),
    ...(scrollable() ? [{ type: "scroll" as const }] : []),
  ])
  const tabGap = createMemo(() => {
    if (headerItems().length <= 1) return 0
    const itemWidth = headerItems().reduce(
      (sum, item) => sum + (item.type === "tab" ? item.group.label.length + 2 : 3),
      0,
    )
    return Math.max(
      WHICH_KEY_MIN_TAB_GAP,
      Math.min(WHICH_KEY_TAB_GAP, Math.floor((contentWidth() - itemWidth) / (headerItems().length - 1))),
    )
  })
  const columnWidth = createMemo(() =>
    Math.max(
      1,
      Math.min(
        WHICH_KEY_MAX_COLUMN_WIDTH,
        Math.floor((contentWidth() - (columns() - 1) * WHICH_KEY_COLUMN_GAP) / columns()),
      ),
    ),
  )
  const clamp = (value: number) => Math.max(0, Math.min(maxOffset(), value))
  const scroll = (delta: number) => setOffset((value) => clamp(value + delta))
  const moveGroup = (delta: number) => {
    if (pendingMode() || !groups().length) return
    const index = Math.max(0, groups().findIndex((group) => group.label === currentGroup()?.label))
    setActiveGroup(groups()[(index + delta + groups().length) % groups().length]?.label)
    setOffset(0)
  }

  useBindings(() => ({
    priority: 1000,
    enabled: visible(),
    commands: [
      { name: whichKeyCommand.groupPrevious, title: "Previous key binding group", desc: "Show the previous which-key group", category: "System", run: () => moveGroup(-1) },
      { name: whichKeyCommand.groupNext, title: "Next key binding group", desc: "Show the next which-key group", category: "System", run: () => moveGroup(1) },
      { name: whichKeyCommand.scrollUp, title: "Scroll key bindings up", desc: "Scroll the which-key panel up", category: "System", run: () => scroll(-columns()) },
      { name: whichKeyCommand.scrollDown, title: "Scroll key bindings down", desc: "Scroll the which-key panel down", category: "System", run: () => scroll(columns()) },
      { name: whichKeyCommand.pageUp, title: "Page key bindings up", desc: "Page the which-key panel up", category: "System", run: () => scroll(-pageSize()) },
      { name: whichKeyCommand.pageDown, title: "Page key bindings down", desc: "Page the which-key panel down", category: "System", run: () => scroll(pageSize()) },
      { name: whichKeyCommand.home, title: "First key binding", desc: "Jump to the first which-key binding", category: "System", run: () => setOffset(0) },
      { name: whichKeyCommand.end, title: "Last key binding", desc: "Jump to the last which-key binding", category: "System", run: () => setOffset(maxOffset()) },
    ],
    bindings: pendingMode()
      ? props.api.tuiConfig.keybinds.gather("which-key.scroll", whichKeyScrollCommands)
      : props.api.tuiConfig.keybinds.gather("which-key.panel", whichKeyPanelCommands),
  }))

  createEffect(() => {
    if (pendingMode()) return
    if (currentGroup()?.label !== activeGroup()) setActiveGroup(currentGroup()?.label)
  })
  createEffect(() => {
    if (pendingMode()) return
    activeGroup()
    setOffset(0)
  })
  createEffect(() => {
    if (!visible()) setOffset(0)
  })
  createEffect(() => {
    pending()
    setOffset(0)
  })
  createEffect(() => setOffset((value) => clamp(value)))

  return {
    dimensions,
    visible,
    headerVisible,
    tabsVisible,
    footerVisible,
    panelHeight,
    rows,
    shown,
    rowIndexes,
    headerItems,
    tabGap,
    columnWidth,
    currentGroup,
    setActiveGroup,
    setOffset,
    upActive: createMemo(() => offset() > 0),
    downActive: createMemo(() => offset() < maxOffset()),
    nextMode: createMemo(() => (props.mode() === "dock" ? "overlay" : "dock")),
    look: createMemo(() => whichKeySkin(props.api)),
    trigger: useWhichKeyShortcut(props.api, whichKeyCommand.toggle),
    modeTrigger: useWhichKeyShortcut(props.api, whichKeyCommand.toggleLayout),
  }
}

export type WhichKeyController = ReturnType<typeof createWhichKeyController>
