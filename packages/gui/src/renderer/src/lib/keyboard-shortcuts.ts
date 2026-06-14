export type GuiShortcutRouteName = "dashboard" | "projects" | "swarms" | "views" | "plugins"

export type GuiShortcutAction =
  | { type: "abort-session"; sessionID: string }
  | { type: "clear-notice" }
  | { type: "open-command-palette" }
  | { type: "prevent-global-shortcut" }
  | { type: "toggle-rail" }
  | { type: "focus-composer" }
  | { type: "create-session" }
  | { type: "refresh" }
  | { type: "show-keyboard-help" }
  | { type: "copy-last-assistant" }
  | { type: "transcript"; action: "first" | "last" | "next" | "previous" | "last-user" }
  | { type: "route"; route: GuiShortcutRouteName }

export type GuiShortcutContext = {
  editing: boolean
  dialogOpen: boolean
  noticeVisible: boolean
  abortableSessionID?: string
}

export type GuiShortcutHandlers = {
  abortSession: (sessionID: string) => void
  clearNotice: () => void
  openCommandPalette: () => void
  toggleRail: () => void
  focusComposer: () => void
  createSession: () => void
  refresh: () => void
  showKeyboardHelp: () => void
  copyLastAssistantMessage: () => void
  transcript: (action: "first" | "last" | "next" | "previous" | "last-user") => void
  route: (route: GuiShortcutRouteName) => void
}

const ROUTES_BY_KEY: Record<string, GuiShortcutRouteName | undefined> = {
  d: "dashboard",
  "1": "projects",
  "2": "swarms",
  "3": "views",
  "4": "plugins",
}

const DIRECT_ACTIONS_BY_KEY: Record<string, GuiShortcutAction | undefined> = {
  b: { type: "toggle-rail" },
  "/": { type: "focus-composer" },
  n: { type: "create-session" },
  r: { type: "refresh" },
}
const GLOBAL_SHORTCUT_KEYS = new Set(["p", "?", "c", "home", "end", "arrowdown", "arrowup", "u", ...Object.keys(DIRECT_ACTIONS_BY_KEY), ...Object.keys(ROUTES_BY_KEY)])

export function guiShortcutAction(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">, context: GuiShortcutContext): GuiShortcutAction | undefined {
  const key = event.key.toLowerCase()
  const escapeAction = escapeShortcutAction(event.key, context)
  if (escapeAction) return escapeAction
  if (event.altKey && !context.dialogOpen && !context.editing) {
    if (key === "home") return { type: "transcript", action: "first" }
    if (key === "end") return { type: "transcript", action: "last" }
    if (key === "arrowdown") return { type: "transcript", action: "next" }
    if (key === "arrowup") return { type: "transcript", action: "previous" }
    if (key === "u") return { type: "transcript", action: "last-user" }
  }
  if (!(event.ctrlKey || event.metaKey)) return
  if (key === "?" || (event.shiftKey && key === "/")) return { type: "show-keyboard-help" }
  if (event.shiftKey && key === "c") return { type: "copy-last-assistant" }
  if (key === "p") return commandPaletteShortcutAction(context)
  if (context.dialogOpen || context.editing) return GLOBAL_SHORTCUT_KEYS.has(key) ? { type: "prevent-global-shortcut" } : undefined
  const action = DIRECT_ACTIONS_BY_KEY[key]
  if (action) return action
  const route = ROUTES_BY_KEY[key]
  return route ? { type: "route", route } : undefined
}

export function runGuiShortcutAction(action: GuiShortcutAction, handlers: GuiShortcutHandlers) {
  if (action.type === "abort-session") return handlers.abortSession(action.sessionID)
  if (action.type === "clear-notice") return handlers.clearNotice()
  if (action.type === "open-command-palette") return handlers.openCommandPalette()
  if (action.type === "prevent-global-shortcut") return
  if (action.type === "toggle-rail") return handlers.toggleRail()
  if (action.type === "focus-composer") return handlers.focusComposer()
  if (action.type === "create-session") return handlers.createSession()
  if (action.type === "refresh") return handlers.refresh()
  if (action.type === "show-keyboard-help") return handlers.showKeyboardHelp()
  if (action.type === "copy-last-assistant") return handlers.copyLastAssistantMessage()
  if (action.type === "transcript") return handlers.transcript(action.action)
  return handlers.route(action.route)
}

function escapeShortcutAction(key: string, context: GuiShortcutContext): GuiShortcutAction | undefined {
  if (key !== "Escape") return
  if (!context.dialogOpen && context.abortableSessionID) return { type: "abort-session", sessionID: context.abortableSessionID }
  return context.noticeVisible ? { type: "clear-notice" } : undefined
}

function commandPaletteShortcutAction(context: GuiShortcutContext): GuiShortcutAction {
  return context.dialogOpen ? { type: "prevent-global-shortcut" } : { type: "open-command-palette" }
}

export function isKeyboardEditingTarget(value: EventTarget | null) {
  return value instanceof HTMLInputElement || value instanceof HTMLTextAreaElement || value instanceof HTMLSelectElement
}
