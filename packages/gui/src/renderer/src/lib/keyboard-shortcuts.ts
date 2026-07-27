export type GuiShortcutRouteName = "dashboard" | "projects" | "swarms" | "views" | "plugins"

export type GuiKeyboardHelpEntry = {
  title: string
  category: string
  description?: string
  shortcut: string
}

export type GuiShortcutAction =
  | { type: "abort-session"; sessionID: string }
  | { type: "clear-notice" }
  | { type: "open-command-palette" }
  | { type: "prevent-global-shortcut" }
  | { type: "toggle-rail" }
  | { type: "toggle-workspace" }
  | { type: "focus-composer" }
  | { type: "create-session" }
  | { type: "refresh" }
  | { type: "show-keyboard-help" }
  | { type: "copy-last-assistant" }
  | { type: "session-switcher"; direction: 1 | -1 }
  | { type: "open-mru-session"; index: number }
  | { type: "transcript"; action: "first" | "last" | "next" | "previous" | "last-user" }
  | { type: "route"; route: GuiShortcutRouteName }

export type GuiShortcutContext = {
  editing: boolean
  dialogOpen: boolean
  sessionSwitcherOpen?: boolean
  noticeVisible?: boolean
  abortableSessionID?: string
}

export type GuiShortcutHandlers = {
  abortSession: (sessionID: string) => void
  clearNotice?: () => void
  openCommandPalette: () => void
  toggleRail: () => void
  toggleWorkspace: () => void
  focusComposer: () => void
  createSession: () => void
  refresh: () => void
  showKeyboardHelp: () => void
  copyLastAssistantMessage: () => void
  sessionSwitcher: (direction: 1 | -1) => void
  openMruSession: (index: number) => void
  transcript: (action: "first" | "last" | "next" | "previous" | "last-user") => void
  route: (route: GuiShortcutRouteName) => void
}

const ROUTE_SHORTCUTS = [
  { key: "d", route: "dashboard", title: "Open dashboard", shortcut: "Ctrl+D" },
  { key: "1", route: "projects", title: "Open projects", shortcut: "Ctrl+1" },
  { key: "2", route: "swarms", title: "Open swarms", shortcut: "Ctrl+2" },
  { key: "3", route: "views", title: "Open views", shortcut: "Ctrl+3" },
  { key: "4", route: "plugins", title: "Open plugins", shortcut: "Ctrl+4" },
] as const

const ROUTES_BY_KEY = new Map<string, GuiShortcutRouteName>(
  ROUTE_SHORTCUTS.map((entry) => [entry.key, entry.route]),
)

export const GUI_NAVIGATION_SHORTCUTS: readonly GuiKeyboardHelpEntry[] = [
  { title: "Toggle session workspace", category: "Navigation", shortcut: "Ctrl+J" },
  { title: "Next recent session", category: "Navigation", shortcut: "Ctrl+Tab" },
  { title: "Previous recent session", category: "Navigation", shortcut: "Ctrl+Shift+Tab" },
  { title: "Open recent session 1-9", category: "Navigation", shortcut: "Alt+1-9" },
  ...ROUTE_SHORTCUTS.map((entry) => ({
    title: entry.title,
    category: "Navigation",
    shortcut: entry.shortcut,
  })),
]

const DIRECT_ACTIONS_BY_KEY: Record<string, GuiShortcutAction | undefined> = {
  b: { type: "toggle-rail" },
  j: { type: "toggle-workspace" },
  "/": { type: "focus-composer" },
  n: { type: "create-session" },
}
const GLOBAL_SHORTCUT_KEYS = new Set([
  "p",
  "?",
  "c",
  "home",
  "end",
  "arrowdown",
  "arrowup",
  "u",
  ...Object.keys(DIRECT_ACTIONS_BY_KEY),
  ...ROUTES_BY_KEY.keys(),
])

export function guiShortcutAction(
  event: Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "defaultPrevented">,
  context: GuiShortcutContext,
): GuiShortcutAction | undefined {
  const key = event.key.toLowerCase()
  if (event.key === "Escape" && event.defaultPrevented) return
  const escapeAction = escapeShortcutAction(event.key, context)
  if (escapeAction) return escapeAction
  if ((event.ctrlKey || event.metaKey) && key === "tab")
    return context.dialogOpen && !context.sessionSwitcherOpen ? { type: "prevent-global-shortcut" } : { type: "session-switcher", direction: event.shiftKey ? -1 : 1 }
  if (event.altKey && !context.dialogOpen && !context.editing) {
    if (key === "home") return { type: "transcript", action: "first" }
    if (key === "end") return { type: "transcript", action: "last" }
    if (key === "arrowdown") return { type: "transcript", action: "next" }
    if (key === "arrowup") return { type: "transcript", action: "previous" }
    if (key === "u") return { type: "transcript", action: "last-user" }
    const mruIndex = mruSessionIndexForKey(key, event.code)
    if (mruIndex !== undefined) return { type: "open-mru-session", index: mruIndex }
  }
  if (!(event.ctrlKey || event.metaKey)) return
  if (key === "?" || (event.shiftKey && key === "/")) return { type: "show-keyboard-help" }
  if (event.shiftKey && key === "c") return { type: "copy-last-assistant" }
  if (key === "p" || key === "k") return commandPaletteShortcutAction(context)
  if (key === "r") return context.dialogOpen ? { type: "prevent-global-shortcut" } : { type: "refresh" }
  if (key === "j") return context.dialogOpen ? { type: "prevent-global-shortcut" } : { type: "toggle-workspace" }
  if (context.dialogOpen || context.editing)
    return GLOBAL_SHORTCUT_KEYS.has(key) ? { type: "prevent-global-shortcut" } : undefined
  const action = DIRECT_ACTIONS_BY_KEY[key]
  if (action) return action
  const route = ROUTES_BY_KEY.get(key)
  return route ? { type: "route", route } : undefined
}

export function runGuiShortcutAction(action: GuiShortcutAction, handlers: GuiShortcutHandlers) {
  if (action.type === "abort-session") return handlers.abortSession(action.sessionID)
  if (action.type === "clear-notice") return handlers.clearNotice?.()
  if (action.type === "open-command-palette") return handlers.openCommandPalette()
  if (action.type === "prevent-global-shortcut") return
  if (action.type === "toggle-rail") return handlers.toggleRail()
  if (action.type === "toggle-workspace") return handlers.toggleWorkspace()
  if (action.type === "focus-composer") return handlers.focusComposer()
  if (action.type === "create-session") return handlers.createSession()
  if (action.type === "refresh") return handlers.refresh()
  if (action.type === "show-keyboard-help") return handlers.showKeyboardHelp()
  if (action.type === "copy-last-assistant") return handlers.copyLastAssistantMessage()
  if (action.type === "session-switcher") return handlers.sessionSwitcher(action.direction)
  if (action.type === "open-mru-session") return handlers.openMruSession(action.index)
  if (action.type === "transcript") return handlers.transcript(action.action)
  return handlers.route(action.route)
}

function mruSessionIndexForKey(key: string, code: string) {
  const digit = /^Digit([1-9])$/.exec(code)?.[1] ?? (key.length === 1 && key >= "1" && key <= "9" ? key : undefined)
  return digit ? Number(digit) - 1 : undefined
}

function escapeShortcutAction(key: string, context: GuiShortcutContext): GuiShortcutAction | undefined {
  if (key !== "Escape") return
  if (context.dialogOpen) return { type: "prevent-global-shortcut" }
  if (!context.dialogOpen && context.abortableSessionID)
    return { type: "abort-session", sessionID: context.abortableSessionID }
  if (context.noticeVisible) return { type: "clear-notice" }
}

function commandPaletteShortcutAction(context: GuiShortcutContext): GuiShortcutAction {
  return context.dialogOpen ? { type: "prevent-global-shortcut" } : { type: "open-command-palette" }
}

export function isKeyboardEditingTarget(value: EventTarget | null) {
  return value instanceof HTMLInputElement || value instanceof HTMLTextAreaElement || value instanceof HTMLSelectElement || (value instanceof HTMLElement && value.isContentEditable)
}
