import { describe, expect, mock, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"

type EnsureCall = { id: string; data: string }
type EnsureArgs = { id: string; write: unknown; openURL: unknown; persistent: unknown }

const ensureCalls: EnsureCall[] = []
const ensureArgs: EnsureArgs[] = []
const markOpenCalls: string[] = []
const markClosedCalls: string[] = []
const disposeCalls: string[] = []
let ensureShouldThrow = false

// The real terminal surface creates an xterm Terminal, which needs
// MutationObserver / DOM APIs this test runner does not provide. Stub it so
// the onData plumbing can be asserted without a browser, following the same
// mock.module pattern used elsewhere in this suite (e.g.
// terminal-launch-profile.test.ts) for a dependency that cannot load here.
// ensureShouldThrow lets one test reproduce the real ensure()'s "8 terminals
// open" failure without needing 8 real views.
await mock.module("../src/renderer/src/components/session-side-terminal-views", () => ({
  terminalSurface: {
    ensure: (id: string, write: unknown, openURL: unknown, persistent: unknown) => {
      ensureArgs.push({ id, write, openURL, persistent })
      if (ensureShouldThrow) throw new Error("This window already has the maximum of 8 terminals open.")
      return {
        terminal: {
          write: (data: string) => {
            ensureCalls.push({ id, data })
          },
        },
      }
    },
    markOpen: (id: string) => {
      markOpenCalls.push(id)
    },
    markClosed: (id: string) => {
      markClosedCalls.push(id)
    },
    attach: () => () => undefined,
    dispose: (id: string) => {
      disposeCalls.push(id)
    },
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
  const write = (_id: string, _data: string) => undefined
  const openURL = (_url: string) => undefined
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
        write,
        openURL,
      },
    })
    return { controller, setSessions, exits, dataListeners, created, write, openURL, dispose }
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

  test("sign-in shell output reaches the shared terminal surface, threading write/openURL; other ids are ignored", () => {
    ensureCalls.length = 0
    ensureArgs.length = 0
    markOpenCalls.length = 0
    const test7 = harness([stranded("a")], async () => ({ state: "signed-in" }))
    test7.dataListeners.forEach((listener) => {
      listener({ id: LOGIN_TERMINAL_ID, data: "Visit https://example.com to finish sign-in" })
      listener({ id: "terminal-session:oxts_other", data: "should not reach the surface" })
    })
    expect(ensureCalls).toEqual([{ id: LOGIN_TERMINAL_ID, data: "Visit https://example.com to finish sign-in" }])
    expect(markOpenCalls).toEqual([LOGIN_TERMINAL_ID])
    // The dialog needs the login shell to be typeable and its OAuth link
    // clickable, so this controller's own write/openURL must be the exact
    // functions handed to ensure(), not dropped in favor of some default.
    expect(ensureArgs).toHaveLength(1)
    expect(ensureArgs[0]?.write).toBe(test7.write)
    expect(ensureArgs[0]?.openURL).toBe(test7.openURL)
    expect(ensureArgs[0]?.persistent).toBe(true)
    test7.dispose()
  })

  test("a terminal-surface failure while receiving sign-in output cannot escape the listener, and is surfaced instead", () => {
    // Reproduces ensure() throwing "This window already has the maximum of 8
    // terminals open.", which happens for real once the shared, global view
    // budget (session terminals plus this login terminal) is full of views
    // the surface will not evict to make room.
    ensureShouldThrow = true
    markClosedCalls.length = 0
    disposeCalls.length = 0
    const test8 = harness([stranded("a")], async () => ({ state: "signed-in" }))
    expect(() => {
      test8.dataListeners.forEach((listener) => listener({ id: LOGIN_TERMINAL_ID, data: "prompt" }))
    }).not.toThrow()
    expect(test8.controller.phase()).toBe("failed")
    expect(test8.controller.message()).toBe("This window already has the maximum of 8 terminals open.")
    // The failure is also visible through close(), which frees the login
    // view's slot in the shared budget instead of leaking it forever.
    test8.controller.close()
    expect(markClosedCalls).toEqual([LOGIN_TERMINAL_ID])
    expect(disposeCalls).toEqual([LOGIN_TERMINAL_ID])
    ensureShouldThrow = false
    test8.dispose()
  })
})
