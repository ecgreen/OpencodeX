/**
 * The one place a session's visible status is decided.
 *
 * This used to be derived three times - once in the sync engine when it
 * persisted `displayStatus`, once in the GUI, once in the TUI - and the three
 * had drifted: the TUI knew about an optimistic pending prompt and an activity
 * heuristic, the GUI knew about neither, so an incomplete assistant turn read
 * as "running" in the TUI and "dormant" in the GUI. Both clients and the
 * reconciler now call into this module, so the persisted value and the two
 * rendered values cannot disagree.
 */
import type { Message, OpencodeXSessionUiState, Part, SessionStatus } from "./client.js"

export type ClientDerivedSessionStatus = "dormant" | "in_progress" | "input_needed" | "needs_review"

/** Persisted vocabulary. Narrower than the derived one: it has no view-level rollup. */
export type ClientSessionDisplayStatus = NonNullable<OpencodeXSessionUiState["displayStatus"]>

export type ClientSessionStatusInput = {
  status?: SessionStatus
  uiState?: OpencodeXSessionUiState
  /** A permission or question is waiting on the reader. */
  hasPendingInteraction: boolean
  /** The reader submitted a prompt this client has not seen the backend pick up yet. */
  pendingPrompt?: boolean
  /** Result of `clientSessionLikelyActive` for this session, when the caller has the transcript. */
  likelyActive?: boolean
}

export type ClientSessionDisplayStatusInput = {
  status?: SessionStatus
  hasPendingInteraction: boolean
  pendingPrompt?: boolean
  likelyActive?: boolean
  /** `session.time.updated`. */
  updatedAt: number
  /** `uiState.reviewedAt`, if the reader has reviewed this session before. */
  reviewedAt?: number
  /**
   * `session.parentID`. A delegated child is never awaiting the reader's
   * review - its parent consumes the report - so it settles to idle instead
   * of `needs_review`. Must mirror the server's `deriveUiState`.
   */
  parentID?: string
}

export type ClientSessionActivityMessage = {
  info: Message
  parts?: readonly Part[]
}

/**
 * How long an incomplete assistant turn keeps reading as activity.
 *
 * Without it, a turn that never finished - the server crashed, the process was
 * killed - looks like it is still running forever. With it, both clients fall
 * back to the persisted status once the session has been quiet this long.
 */
export const CLIENT_SESSION_ACTIVITY_WINDOW_MS = 15 * 60 * 1000

/**
 * Precedence, highest first:
 * 1. `input_needed` - something is blocked on the reader.
 * 2. `in_progress`  - the backend is working, or this client believes it is.
 * 3. `needs_review` - finished work the reader has not looked at yet.
 * 4. `dormant`.
 */
export function deriveClientSessionStatus(input: ClientSessionStatusInput): ClientDerivedSessionStatus {
  const displayStatus = input.uiState?.displayStatus
  if (input.hasPendingInteraction || displayStatus === "input_needed") return "input_needed"
  if (isClientSessionWorking(input) || displayStatus === "in_progress") return "in_progress"
  if (displayStatus === "needs_review" && input.uiState?.updated !== false) return "needs_review"
  return "dormant"
}

/**
 * The persisted `displayStatus` for a session, on the same precedence as
 * `deriveClientSessionStatus`. `needs_review` here is a fact about review
 * bookkeeping (work landed after the last review), not about the reader's seen
 * state, which the derived status layers on top.
 */
export function deriveClientSessionDisplayStatus(input: ClientSessionDisplayStatusInput): ClientSessionDisplayStatus {
  if (input.hasPendingInteraction) return "input_needed"
  if (isClientSessionWorking(input)) return "in_progress"
  if (!input.parentID && input.updatedAt > (input.reviewedAt ?? 0)) return "needs_review"
  return "idle"
}

/** Rolls a group of session statuses up to the one status the group should show. */
export function deriveClientViewStatus(statuses: readonly ClientDerivedSessionStatus[]): ClientDerivedSessionStatus {
  if (statuses.includes("input_needed")) return "input_needed"
  if (statuses.includes("in_progress")) return "in_progress"
  if (statuses.includes("needs_review")) return "needs_review"
  return "dormant"
}

/** True for anything the reader might want to act on. */
export function isActiveClientSessionStatus(status: ClientDerivedSessionStatus) {
  return status !== "dormant"
}

/** Lowercase label, for inline sentence use ("running", "needs input", ...). */
export function clientSessionStatusLabel(status: ClientDerivedSessionStatus) {
  return {
    in_progress: "running",
    input_needed: "needs input",
    needs_review: "ready for review",
    dormant: "idle",
  }[status]
}

/**
 * Best-effort "the model is probably mid-turn" signal, for the window between
 * the backend starting work and the client seeing a `busy` status.
 *
 * The last assistant message must be incomplete *and* the session must have
 * been touched inside the activity window, so a permanently-incomplete turn
 * stops reading as running instead of doing so forever.
 */
export function clientSessionLikelyActive(
  messages: readonly ClientSessionActivityMessage[],
  sessionUpdatedAt: number,
  now = Date.now(),
) {
  if (!(sessionUpdatedAt > 0)) return false
  if (now - sessionUpdatedAt > CLIENT_SESSION_ACTIVITY_WINDOW_MS) return false
  const lastAssistant = findLastAssistant(messages)
  if (!lastAssistant) return false
  const info = lastAssistant.info
  if (info.role !== "assistant" || info.time.completed || info.finish) return false
  const parts = lastAssistant.parts ?? []
  if (parts.some((part) => part.type === "tool" && part.state.status === "running")) return true
  if (parts.some((part) => part.type === "step-start") && !parts.some((part) => part.type === "step-finish"))
    return true
  return parts.length > 0
}

function isClientSessionWorking(input: { status?: SessionStatus; pendingPrompt?: boolean; likelyActive?: boolean }) {
  if (input.status?.type === "busy" || input.status?.type === "retry") return true
  if (input.pendingPrompt === true) return true
  return input.likelyActive === true
}

function findLastAssistant(messages: readonly ClientSessionActivityMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.info.role === "assistant") return message
  }
  return undefined
}
