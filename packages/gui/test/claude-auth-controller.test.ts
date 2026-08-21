import { describe, expect, mock, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"

type EnsureCall = { id: string; data: string }

const ensureCalls: EnsureCall[] = []
const markOpenCalls: string[] = []

// The real terminal surface creates an xterm `Terminal`, which needs
// `MutationObserver`/DOM APIs this test runner doesn't provide. Stub it so the
// onData plumbing can be asserted without a browser, following the same
// mock.module pattern used elsewhere in this suite (e.g.
// terminal-launch-profile.test.ts) for a dependency that can't load here.
await mock.module("../src/renderer/src/components/session-side-terminal-views", () => ({
  terminalSurface: {
    ensure: (id: string) => ({
      terminal: {
        write: (data: string) => {
          ensureCalls.push({ id, data })
        },
      },
    }),
    markOpen: (id: string) => {
      markOpenCalls.push(id)
    },
    markClosed: () => undefined,
    attach: () => () => undefined,
    dispose: () => undefined,
    focus: () => undefined,
  },
}))

const { createClaudeAuthController, LOGIN_TERMINAL_ID } = await import("../src/renderer/src/controllers/claude-auth-controller")

type Session = { id: string; metadata?: unknown }
type AuthStatus = { state: "signed-in" | "signed-out" | "unknown"; message?: string }

function stranded(id: string): Session {
  return { id, metadata: { claudeCode: { launched: true, authState: "needs-login" } } }
}

function healthy(id: string): Session {
  return { id, metadata: { claudeCode: { launched: true, authState: "ready" } } }
}

type CreateTerminalResult = { ok: boolean; pid?: number; message?: string }
type CreateTerminalDep = (input: { id: string }) => Promise<CreateTerminalResult>

function harness(initial: Session[], authStatus: () => Promise<AuthStatus>, createTerminal?: CreateTerminalDep) {
  const [sessions, setSessions] = createSignal(initial)
  const exits: Array<(event: { id: string }) => void> = []
  const dataListeners: Array<(event: { id: string; data: string }) => void> = []
  const created: string[] = []
  const create = createTerminal ?? defaultCreateTerminal
  return createRoot((dispose) => {
    const controller = createClaudeAuthController({
      sessions,
      deps: {
        authStatus,
        createTerminal: async (input) => {
          created.push(input.id)
          return create(input)
        },
        destroyTerminal: async () => true,
        onExit: (listener) => {
          exits.push(listener)
          return () => undefined
        },
        onData: (listener) => {
          dataListeners.push(listener)
          return () => undefined
        },
      },
    })
    return { controller, setSessions, exits, dataListeners, created, dispose }
  })
}

async function defaultCreateTerminal(): Promise<CreateTerminalResult> {
  return { ok: true, pid: 1 }
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

  test("a rejecting createTerminal still lands in failed, leaving phase free for a retry", async () => {
    let attempts = 0
    const test6 = harness([stranded("a")], async () => ({ state: "signed-in" }), async () => {
      attempts += 1
      if (attempts === 1) throw new Error("IPC channel closed")
      return { ok: true, pid: 1 }
    })
    await test6.controller.signIn()
    expect(test6.controller.phase()).toBe("failed")
    expect(test6.controller.message()).toBe("IPC channel closed")
    // Not stuck: a second attempt can run right after, instead of being
    // wedged on "signing-in" forever by the first attempt's unhandled rejection.
    await test6.controller.signIn()
    expect(test6.controller.phase()).toBe("signing-in")
    expect(test6.created).toEqual([LOGIN_TERMINAL_ID, LOGIN_TERMINAL_ID])
    test6.dispose()
  })

  test("sign-in shell output reaches the shared terminal surface; other ids are ignored", () => {
    ensureCalls.length = 0
    markOpenCalls.length = 0
    const test7 = harness([stranded("a")], async () => ({ state: "signed-in" }))
    test7.dataListeners.forEach((listener) => {
      listener({ id: LOGIN_TERMINAL_ID, data: "Visit https://example.com to finish sign-in" })
      listener({ id: "terminal-session:oxts_other", data: "should not reach the surface" })
    })
    expect(ensureCalls).toEqual([{ id: LOGIN_TERMINAL_ID, data: "Visit https://example.com to finish sign-in" }])
    expect(markOpenCalls).toEqual([LOGIN_TERMINAL_ID])
    test7.dispose()
  })
})
