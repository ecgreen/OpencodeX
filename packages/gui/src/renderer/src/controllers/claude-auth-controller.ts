import { createMemo, createSignal, onCleanup } from "solid-js"
import type { ClaudeAuthStatus, TerminalCreateInput, TerminalResult } from "../../../preload/index.cts"
import { terminalSurface } from "../components/session-side-terminal-views"
import { claudeSessionAuthState } from "../lib/claude-session-auth"

/** One PTY for the whole app: a second sign-in shell would race the first. */
export const LOGIN_TERMINAL_ID = "claude-login"

export type ClaudeAuthPhase = "idle" | "signing-in" | "checking" | "signed-in" | "failed"

export type ClaudeAuthDeps = {
  authStatus: () => Promise<ClaudeAuthStatus>
  createTerminal: (input: TerminalCreateInput) => Promise<TerminalResult>
  destroyTerminal: (id: string) => Promise<boolean>
  onExit: (listener: (event: { id: string }) => void) => () => void
  onData: (listener: (event: { id: string; data: string }) => void) => () => void
  write: (id: string, data: string) => void
  openURL: (url: string) => void
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
    onData: (listener) => window.opencodex?.terminal?.onData(listener) ?? (() => undefined),
    write: (id, data) => window.opencodex?.terminal?.write({ id, data }),
    openURL: (url) => void window.opencodex?.browser?.external(url),
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

  // Subscribed here, before any signIn() call, so no byte the PTY writes
  // between opening the dialog and its first output can be lost to the race.
  // `persistent: true` matches how real Claude Code session terminals open
  // (session-side-terminal-views only evicts non-persistent views to free a
  // slot), so once this view exists it keeps the OAuth URL the CLI printed
  // rather than losing it to eviction the next time some other terminal needs
  // room. That does mean `ensure()` can throw here - the shared view budget
  // is global, and 8 already-open persistent session terminals leave nothing
  // to evict - so this mirrors claude-terminal-controller.ts's onData handler
  // and turns that throw into a visible failure instead of an unhandled
  // exception inside an IPC listener.
  onCleanup(
    deps.onData((event) => {
      if (event.id !== LOGIN_TERMINAL_ID) return
      try {
        terminalSurface.ensure(event.id, deps.write, deps.openURL, true).terminal.write(event.data)
        terminalSurface.markOpen(event.id)
      } catch (error) {
        setPhase("failed")
        setMessage(error instanceof Error ? error.message : "Could not open the sign-in terminal.")
      }
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
    // A rejection (IPC error, destroyed renderer) must land here too, or phase
    // stays "signing-in" forever with no way for the user to retry.
    const result = await deps
      .createTerminal({ id: LOGIN_TERMINAL_ID, profile: { kind: "claude-login" }, cols: 100, rows: 30 })
      .catch((error): TerminalResult => ({ ok: false, message: error instanceof Error ? error.message : String(error) }))
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
    // Clears any stale message from a previous attempt before the dialog
    // becomes visible again, regardless of how it was opened. `phase` is left
    // alone: `signIn()` already re-derives it, and the stage/session banners
    // read a "failed" phase while the dialog is closed, so resetting it here
    // (or in `close()`) would blank the banner's "Try again" state the moment
    // the dialog that produced it goes away.
    open: () => {
      setMessage(undefined)
      setOpen(true)
    },
    close: () => {
      setOpen(false)
      // Persistent views never get evicted on their own, so this login view
      // would otherwise sit in the shared 8-slot budget forever after the
      // dialog closes, permanently starving session terminals of one slot -
      // but the teardown must wait for the PTY to actually be gone first.
      // The onData subscription above stays live across close()/signIn()
      // cycles, so disposing the view before destroy settles would let a
      // chunk in flight re-enter ensure() and rebuild a brand-new, orphaned
      // terminal - reopening the very leak this teardown exists to close.
      void deps
        .destroyTerminal(LOGIN_TERMINAL_ID)
        .catch(() => false)
        .finally(() => {
          terminalSurface.markClosed(LOGIN_TERMINAL_ID)
          terminalSurface.dispose(LOGIN_TERMINAL_ID)
        })
    },
    signIn,
  }
}
