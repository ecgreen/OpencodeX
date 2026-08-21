import { describe, expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { createClaudeAuthController, LOGIN_TERMINAL_ID } from "../src/renderer/src/controllers/claude-auth-controller"

type Session = { id: string; metadata?: unknown }

function stranded(id: string): Session {
  return { id, metadata: { claudeCode: { launched: true, authState: "needs-login" } } }
}

function healthy(id: string): Session {
  return { id, metadata: { claudeCode: { launched: true, authState: "ready" } } }
}

function harness(initial: Session[], authStatus: () => Promise<{ state: "signed-in" | "signed-out" | "unknown"; message?: string }>) {
  const [sessions, setSessions] = createSignal(initial)
  const exits: Array<(event: { id: string }) => void> = []
  const created: string[] = []
  return createRoot((dispose) => {
    const controller = createClaudeAuthController({
      sessions,
      deps: {
        authStatus,
        createTerminal: async (input) => {
          created.push(input.id)
          return { ok: true, pid: 1 }
        },
        destroyTerminal: async () => true,
        onExit: (listener) => {
          exits.push(listener)
          return () => undefined
        },
      },
    })
    return { controller, setSessions, exits, created, dispose }
  })
}

describe("claude sign-in controller", () => {
  test("shows once when any session is stranded, since the credential is machine-wide", () => {
    const test1 = harness([healthy("a")], async () => ({ state: "signed-in" }))
    expect(test1.controller.visible()).toBe(false)
    test1.setSessions([healthy("a"), stranded("b")])
    expect(test1.controller.visible()).toBe(true)
    test1.dispose()
  })

  test("clears the banner after a confirmed sign-in, without waiting on metadata", async () => {
    const test2 = harness([stranded("a")], async () => ({ state: "signed-in" }))
    expect(test2.controller.visible()).toBe(true)
    await test2.controller.signIn()
    expect(test2.created).toEqual([LOGIN_TERMINAL_ID])
    test2.exits.forEach((listener) => listener({ id: LOGIN_TERMINAL_ID }))
    await Promise.resolve()
    await Promise.resolve()
    expect(test2.controller.phase()).toBe("signed-in")
    expect(test2.controller.visible()).toBe(false)
    test2.dispose()
  })

  test("a newly stranded session brings the banner back after suppression", async () => {
    const test3 = harness([stranded("a")], async () => ({ state: "signed-in" }))
    await test3.controller.signIn()
    test3.exits.forEach((listener) => listener({ id: LOGIN_TERMINAL_ID }))
    await Promise.resolve()
    await Promise.resolve()
    expect(test3.controller.visible()).toBe(false)
    test3.setSessions([stranded("a"), stranded("b")])
    expect(test3.controller.visible()).toBe(true)
    test3.dispose()
  })

  test("an unknown or signed-out probe leaves the banner up", async () => {
    const test4 = harness([stranded("a")], async () => ({ state: "unknown", message: "Could not read status." }))
    await test4.controller.signIn()
    test4.exits.forEach((listener) => listener({ id: LOGIN_TERMINAL_ID }))
    await Promise.resolve()
    await Promise.resolve()
    expect(test4.controller.phase()).toBe("failed")
    expect(test4.controller.visible()).toBe(true)
    test4.dispose()
  })

  test("ignores exits from terminals that are not the sign-in shell", async () => {
    const test5 = harness([stranded("a")], async () => ({ state: "signed-in" }))
    await test5.controller.signIn()
    test5.exits.forEach((listener) => listener({ id: "terminal-session:oxts_other" }))
    await Promise.resolve()
    expect(test5.controller.phase()).toBe("signing-in")
    test5.dispose()
  })
})
