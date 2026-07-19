import { describe, expect, test } from "bun:test"
import { guiShortcutAction, runGuiShortcutAction } from "../src/renderer/src/lib/keyboard-shortcuts"

describe("GUI keyboard shortcuts", () => {
  test("aborts an active session before clearing notices", () => {
    expect(shortcut("Escape", { abortableSessionID: "ses_busy", noticeVisible: true })).toEqual({
      type: "abort-session",
      sessionID: "ses_busy",
    })
  })

  test("clears notices when escape is not reserved for abort", () => {
    expect(shortcut("Escape", { noticeVisible: true })).toEqual({ type: "clear-notice" })
  })

  test("ignores escape already handled by a composer menu", () => {
    expect(shortcut("Escape", { defaultPrevented: true, abortableSessionID: "ses_busy" })).toBeUndefined()
  })

  test("opens the command palette with ctrl p even from an editor field", () => {
    expect(shortcut("p", { ctrlKey: true, editing: true })).toEqual({ type: "open-command-palette" })
  })

  test("opens the command palette with ctrl k as an alias", () => {
    expect(shortcut("k", { ctrlKey: true, editing: true })).toEqual({ type: "open-command-palette" })
    expect(shortcut("k", { metaKey: true, dialogOpen: true })).toEqual({ type: "prevent-global-shortcut" })
  })

  test("prevents global shortcuts while a dialog is open or input is focused", () => {
    expect(shortcut("p", { ctrlKey: true, dialogOpen: true })).toEqual({ type: "prevent-global-shortcut" })
    expect(shortcut("n", { ctrlKey: true, editing: true })).toEqual({ type: "prevent-global-shortcut" })
    expect(shortcut("3", { ctrlKey: true, editing: true })).toEqual({ type: "prevent-global-shortcut" })
  })

  test("routes navigation shortcuts by key", () => {
    expect(shortcut("d", { ctrlKey: true })).toEqual({ type: "route", route: "dashboard" })
    expect(shortcut("1", { ctrlKey: true })).toEqual({ type: "route", route: "projects" })
    expect(shortcut("2", { ctrlKey: true })).toEqual({ type: "route", route: "swarms" })
    expect(shortcut("3", { metaKey: true })).toEqual({ type: "route", route: "views" })
    expect(shortcut("4", { metaKey: true })).toEqual({ type: "route", route: "plugins" })
    expect(shortcut("5", { ctrlKey: true })).toEqual({ type: "route", route: "workbench" })
  })

  test("returns command actions for non-navigation shortcuts", () => {
    expect(shortcut("b", { ctrlKey: true })).toEqual({ type: "toggle-rail" })
    expect(shortcut("/", { ctrlKey: true })).toEqual({ type: "focus-composer" })
    expect(shortcut("n", { ctrlKey: true })).toEqual({ type: "create-session" })
    expect(shortcut("r", { ctrlKey: true })).toEqual({ type: "refresh" })
  })

  test("refreshes with ctrl r even from an editor field", () => {
    expect(shortcut("r", { ctrlKey: true, editing: true })).toEqual({ type: "refresh" })
    expect(shortcut("r", { ctrlKey: true, dialogOpen: true })).toEqual({ type: "prevent-global-shortcut" })
  })

  test("cycles the session switcher with ctrl tab", () => {
    expect(shortcut("Tab", { ctrlKey: true })).toEqual({ type: "session-switcher", direction: 1 })
    expect(shortcut("Tab", { ctrlKey: true, shiftKey: true })).toEqual({ type: "session-switcher", direction: -1 })
    expect(shortcut("Tab", { ctrlKey: true, editing: true })).toEqual({ type: "session-switcher", direction: 1 })
    expect(shortcut("Tab", { ctrlKey: true, dialogOpen: true })).toEqual({ type: "prevent-global-shortcut" })
  })

  test("jumps to recent sessions with alt digit", () => {
    expect(shortcut("1", { altKey: true })).toEqual({ type: "open-mru-session", index: 0 })
    expect(shortcut("9", { altKey: true })).toEqual({ type: "open-mru-session", index: 8 })
    expect(shortcut("0", { altKey: true })).toBeUndefined()
    expect(shortcut("1", { altKey: true, editing: true })).toBeUndefined()
    expect(shortcut("1", { altKey: true, dialogOpen: true })).toBeUndefined()
    expect(shortcut("¡", { altKey: true, code: "Digit1" })).toEqual({ type: "open-mru-session", index: 0 })
  })

  test("allows cycling only inside the session switcher overlay", () => {
    expect(shortcut("Tab", { ctrlKey: true, dialogOpen: true, sessionSwitcherOpen: true })).toEqual({ type: "session-switcher", direction: 1 })
    expect(shortcut("k", { ctrlKey: true, dialogOpen: true, sessionSwitcherOpen: true })).toEqual({ type: "prevent-global-shortcut" })
    expect(shortcut("Escape", { dialogOpen: true, abortableSessionID: "ses_busy" })).toEqual({ type: "prevent-global-shortcut" })
  })

  test("ignores unknown keys and unmodified shortcuts", () => {
    expect(shortcut("n")).toBeUndefined()
    expect(shortcut("x", { ctrlKey: true })).toBeUndefined()
  })

  test("runs shortcut actions through injected handlers", () => {
    const calls: string[] = []
    const handlers = {
      abortSession: (sessionID: string) => calls.push(`abort:${sessionID}`),
      clearNotice: () => calls.push("clear-notice"),
      openCommandPalette: () => calls.push("palette"),
      toggleRail: () => calls.push("toggle-rail"),
      focusComposer: () => calls.push("focus-composer"),
      createSession: () => calls.push("create-session"),
      refresh: () => calls.push("refresh"),
      showKeyboardHelp: () => calls.push("help"),
      copyLastAssistantMessage: () => calls.push("copy-last"),
      sessionSwitcher: (direction: number) => calls.push(`switcher:${direction}`),
      openMruSession: (index: number) => calls.push(`mru:${index}`),
      transcript: (action: string) => calls.push(`transcript:${action}`),
      route: (route: string) => calls.push(`route:${route}`),
    }

    runGuiShortcutAction({ type: "abort-session", sessionID: "ses_busy" }, handlers)
    runGuiShortcutAction({ type: "prevent-global-shortcut" }, handlers)
    runGuiShortcutAction({ type: "route", route: "dashboard" }, handlers)
    runGuiShortcutAction({ type: "session-switcher", direction: -1 }, handlers)
    runGuiShortcutAction({ type: "open-mru-session", index: 2 }, handlers)
    runGuiShortcutAction({ type: "refresh" }, handlers)

    expect(calls).toEqual(["abort:ses_busy", "route:dashboard", "switcher:-1", "mru:2", "refresh"])
  })
})

function shortcut(
  key: string,
  input: Partial<Parameters<typeof guiShortcutAction>[1]> & { ctrlKey?: boolean; metaKey?: boolean; code?: string; defaultPrevented?: boolean } = {},
) {
  return guiShortcutAction(
    {
      key,
      code: input.code ?? (key.length === 1 ? `Key${key.toUpperCase()}` : key),
      ctrlKey: input.ctrlKey ?? false,
      metaKey: input.metaKey ?? false,
      altKey: input.altKey ?? false,
      shiftKey: input.shiftKey ?? false,
      defaultPrevented: input.defaultPrevented ?? false,
    },
    {
      editing: input.editing ?? false,
      dialogOpen: input.dialogOpen ?? false,
      sessionSwitcherOpen: input.sessionSwitcherOpen ?? false,
      noticeVisible: input.noticeVisible ?? false,
      abortableSessionID: input.abortableSessionID,
    },
  )
}
