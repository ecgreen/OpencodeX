import { createMemo, createSignal, onCleanup } from "solid-js"
import type { ClaudeAuthStatus, TerminalCreateInput, TerminalResult } from "../../../preload/index.cts"
import { claudeSessionAuthState } from "../lib/claude-session-auth"

/** One PTY for the whole app: a second sign-in shell would race the first. */
export const LOGIN_TERMINAL_ID = "claude-login"

export type ClaudeAuthPhase = "idle" | "signing-in" | "checking" | "signed-in" | "failed"

export type ClaudeAuthDeps = {
  authStatus: () => Promise<ClaudeAuthStatus>
  createTerminal: (input: TerminalCreateInput) => Promise<TerminalResult>
  destroyTerminal: (id: string) => Promise<boolean>
  onExit: (listener: (event: { id: string }) => void) => () => void
}

/**
 * Recovery for an expired Claude Code sign-in.
 *
 * The credential is machine-wide, so the stranded state is derived from the
 * session snapshot rather than stored: any session in `needs-login` means every
 * Claude Subscription session is stuck. Session metadata only returns to
 * `ready` on the next successful turn, so a confirmed sign-in suppresses the
 * banner locally - keyed on *which* sessions are stranded, so that a later,
 * genuinely new failure brings it back instead of being swallowed by a boolean.
 */
export function createClaudeAuthController(input: {
  sessions: () => Array<{ id: string; metadata?: unknown }>
  deps?: Partial<ClaudeAuthDeps>
}) {
  const deps: ClaudeAuthDeps = {
    authStatus: () => window.opencodex!.claude.authStatus(),
    createTerminal: (create) => window.opencodex!.terminal!.create(create),
    destroyTerminal: (id) => window.opencodex!.terminal!.destroy(id),
    onExit: (listener) => window.opencodex?.terminal?.onExit(listener) ?? (() => undefined),
    ...input.deps,
  }

  const [phase, setPhase] = createSignal<ClaudeAuthPhase>("idle")
  const [message, setMessage] = createSignal<string>()
  const [open, setOpen] = createSignal(false)
  const [suppressed, setSuppressed] = createSignal<string>()

  const strandedKey = createMemo(() =>
    input
      .sessions()
      .filter((session) => claudeSessionAuthState(session.metadata) === "needs-login")
      .map((session) => session.id)
      .sort()
      .join(","),
  )

  const visible = createMemo(() => strandedKey().length > 0 && strandedKey() !== suppressed())

  onCleanup(
    deps.onExit((event) => {
      if (event.id !== LOGIN_TERMINAL_ID) return
      void check()
    }),
  )

  async function check() {
    setPhase("checking")
    const status = await deps.authStatus()
    if (status.state === "signed-in") {
      setSuppressed(strandedKey())
      setMessage(undefined)
      setPhase("signed-in")
      return
    }
    setPhase("failed")
    setMessage(
      status.state === "signed-out"
        ? "Sign-in did not complete. Try again."
        : (status.message ?? "Could not confirm the sign-in. Retry your message to find out."),
    )
  }

  async function signIn() {
    setPhase("signing-in")
    setMessage(undefined)
    setOpen(true)
    // A shell left over from an abandoned attempt would be answered as a
    // duplicate rather than restarted.
    await deps.destroyTerminal(LOGIN_TERMINAL_ID).catch(() => false)
    const result = await deps.createTerminal({ id: LOGIN_TERMINAL_ID, profile: { kind: "claude-login" }, cols: 100, rows: 30 })
    if (result.ok) return
    setPhase("failed")
    setMessage(result.message ?? "Could not start Claude Code sign-in.")
  }

  return {
    terminalID: LOGIN_TERMINAL_ID,
    phase,
    message,
    visible,
    isOpen: open,
    open: () => setOpen(true),
    close: () => {
      setOpen(false)
      void deps.destroyTerminal(LOGIN_TERMINAL_ID).catch(() => false)
    },
    signIn,
  }
}
