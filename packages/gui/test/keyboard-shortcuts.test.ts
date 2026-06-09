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

  test("opens the command palette with ctrl p even from an editor field", () => {
    expect(shortcut("p", { ctrlKey: true, editing: true })).toEqual({ type: "open-command-palette" })
  })

  test("prevents global shortcuts while a dialog is open or input is focused", () => {
    expect(shortcut("p", { ctrlKey: true, dialogOpen: true })).toEqual({ type: "prevent-global-shortcut" })
    expect(shortcut("n", { ctrlKey: true, editing: true })).toEqual({ type: "prevent-global-shortcut" })
  })

  test("routes navigation shortcuts by key", () => {
    expect(shortcut("d", { ctrlKey: true })).toEqual({ type: "route", route: "dashboard" })
    expect(shortcut("4", { metaKey: true })).toEqual({ type: "route", route: "views" })
  })

  test("returns command actions for non-navigation shortcuts", () => {
    expect(shortcut("b", { ctrlKey: true })).toEqual({ type: "toggle-rail" })
    expect(shortcut("/", { ctrlKey: true })).toEqual({ type: "focus-composer" })
    expect(shortcut("n", { ctrlKey: true })).toEqual({ type: "create-session" })
    expect(shortcut("r", { ctrlKey: true })).toEqual({ type: "refresh" })
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
      route: (route: string) => calls.push(`route:${route}`),
    }

    runGuiShortcutAction({ type: "abort-session", sessionID: "ses_busy" }, handlers)
    runGuiShortcutAction({ type: "prevent-global-shortcut" }, handlers)
    runGuiShortcutAction({ type: "route", route: "dashboard" }, handlers)
    runGuiShortcutAction({ type: "refresh" }, handlers)

    expect(calls).toEqual(["abort:ses_busy", "route:dashboard", "refresh"])
  })
})

function shortcut(
  key: string,
  input: Partial<Parameters<typeof guiShortcutAction>[1]> & { ctrlKey?: boolean; metaKey?: boolean } = {},
) {
  return guiShortcutAction(
    {
      key,
      ctrlKey: input.ctrlKey ?? false,
      metaKey: input.metaKey ?? false,
    },
    {
      editing: input.editing ?? false,
      dialogOpen: input.dialogOpen ?? false,
      noticeVisible: input.noticeVisible ?? false,
      abortableSessionID: input.abortableSessionID,
    },
  )
}
