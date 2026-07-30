/**
 * Pure bookkeeping for the TUI's bounded transcript window.
 *
 * The TUI used to hydrate every message of every session it ever visited and
 * mount all of them in one `<For>`. This module owns the arithmetic that keeps
 * a session's rendered transcript bounded: which page cursor comes next, when
 * "load older" is available, and where the render cap cuts the head off.
 *
 * It is deliberately free of Solid, opentui and the SDK controller so the rules
 * can be unit tested on their own.
 */

/** Messages requested when a session is first opened or re-tailed. */
export const TUI_SESSION_TAIL_LIMIT = 128
/** Messages requested per explicit "load older" step. Mirrors the GUI's `SESSION_MESSAGE_PAGE_LIMIT`. */
export const TUI_SESSION_PAGE_LIMIT = 128
/** Hard ceiling on messages held for render while the reader has not expanded the window. */
export const TUI_SESSION_RENDER_CAP = 384
/** Page size for read-only full-transcript walks (export, copy, timeline). */
export const TUI_SESSION_TRANSCRIPT_PAGE_LIMIT = 500
/** Grace period between a session losing its last retainer and its state being dropped. */
export const TUI_SESSION_RELEASE_DELAY_MS = 60_000
/** Recently visited sessions kept resident so back-and-forth navigation does not refetch. */
export const TUI_SESSION_WARM_LIMIT = 4

export type TuiMessageBoundary = { hasMore: boolean; next?: string }

export type TuiTranscriptWindow = {
  /** Older history exists before the first rendered message. */
  hasOlder: boolean
  /** Cursor to pass as `before` when fetching the next older page. */
  olderCursor?: string
  loadingOlder: boolean
  /**
   * The reader pulled at least one older page. Like the GUI's
   * `messageWindowExpanded`, this suspends the render cap: trimming back what
   * somebody deliberately asked for would make "load older" a no-op.
   */
  expanded: boolean
  /** The render cap is currently hiding older messages that are already loaded. */
  trimmed: boolean
}

export type TuiTranscriptMessage = { id: string; time: { created: number } }

/** Shared read-only default. Copy it before handing it to a reactive store. */
export const EMPTY_TUI_TRANSCRIPT_WINDOW: TuiTranscriptWindow = Object.freeze({
  hasOlder: false,
  loadingOlder: false,
  expanded: false,
  trimmed: false,
})

/**
 * Window for a freshly loaded tail.
 *
 * A tail refresh never un-expands the reader's view, and never overrides a
 * trimmed window: when the render cap is hiding messages that are already
 * loaded, the cap's own boundary is nearer than the server's and is the one
 * "load older" has to resume from.
 */
export function tuiTranscriptFromTail(
  boundary: TuiMessageBoundary,
  previous?: TuiTranscriptWindow,
): TuiTranscriptWindow {
  if (previous?.expanded || previous?.trimmed) return { ...previous, loadingOlder: false }
  return {
    hasOlder: boundary.hasMore,
    ...(boundary.hasMore && boundary.next !== undefined ? { olderCursor: boundary.next } : {}),
    loadingOlder: false,
    expanded: false,
    trimmed: false,
  }
}

/** Window after an explicit older page landed. */
export function tuiTranscriptAfterOlderPage(
  current: TuiTranscriptWindow,
  boundary: TuiMessageBoundary,
): TuiTranscriptWindow {
  return {
    hasOlder: boundary.hasMore,
    ...(boundary.hasMore && boundary.next !== undefined ? { olderCursor: boundary.next } : {}),
    loadingOlder: false,
    expanded: true,
    trimmed: false,
  }
}

/**
 * Applies the render cap to a session's loaded message list.
 *
 * Returns the IDs that should actually be mounted plus the window those IDs
 * imply. When the head is cut, `hasOlder` turns on and `olderCursor` moves to
 * just before the first surviving message so "load older" resumes from there.
 */
export function tuiTranscriptTrim(
  messageIDs: readonly string[],
  message: (messageID: string) => TuiTranscriptMessage | undefined,
  current: TuiTranscriptWindow,
  cap = TUI_SESSION_RENDER_CAP,
): { ids: readonly string[]; window: TuiTranscriptWindow } {
  if (current.expanded || messageIDs.length <= cap)
    return { ids: messageIDs, window: current.trimmed ? { ...current, trimmed: false } : current }
  const kept = messageIDs.slice(messageIDs.length - cap)
  const cursor = tuiMessageCursorBefore(message(kept[0]!))
  return {
    ids: kept,
    window: {
      ...current,
      hasOlder: true,
      ...(cursor === undefined ? {} : { olderCursor: cursor }),
      trimmed: true,
    },
  }
}

/**
 * Builds the pagination cursor that selects everything strictly older than
 * `message`. Must stay byte-identical with the server's `MessageV2.cursor`
 * encoding (base64url of `{ id, time }`).
 */
export function tuiMessageCursorBefore(message: TuiTranscriptMessage | undefined) {
  if (!message || typeof message.time?.created !== "number") return undefined
  return Buffer.from(JSON.stringify({ id: message.id, time: message.time.created })).toString("base64url")
}

/**
 * Moves `sessionID` to the front of the warm LRU.
 *
 * `evicted` lists the sessions that fell out and are therefore now eligible for
 * deferred release.
 */
export function tuiWarmSessions(
  current: readonly string[],
  sessionID: string,
  limit = TUI_SESSION_WARM_LIMIT,
): { warm: string[]; evicted: string[] } {
  const next = [sessionID, ...current.filter((item) => item !== sessionID)]
  if (next.length <= limit) return { warm: next, evicted: [] }
  return { warm: next.slice(0, limit), evicted: next.slice(limit) }
}

export function tuiWarmSessionsWithout(current: readonly string[], sessionID: string) {
  if (!current.includes(sessionID)) return current as string[]
  return current.filter((item) => item !== sessionID)
}

export function sameTuiTranscriptWindow(left: TuiTranscriptWindow | undefined, right: TuiTranscriptWindow) {
  return (
    left !== undefined &&
    left.hasOlder === right.hasOlder &&
    left.olderCursor === right.olderCursor &&
    left.loadingOlder === right.loadingOlder &&
    left.expanded === right.expanded &&
    left.trimmed === right.trimmed
  )
}
