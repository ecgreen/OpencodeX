import type { Message, OpencodeXSessionSnapshot, Part } from "./client.js"
import type { ClientStateSyncController } from "./client-sync-types.js"

export type ClientSessionTranscriptBundle = { info: Message; parts: Part[] }

export type ClientSessionTranscript = {
  messages: ClientSessionTranscriptBundle[]
  /** Cursor of the oldest page reached, if the walk stopped early. */
  cursor?: string
  /** The newest page, carrying the session's current todos, diff and metadata. */
  latest: OpencodeXSessionSnapshot
  pages: number
}

export type ClientSessionTranscriptOptions = {
  pageLimit?: number
  signal?: AbortSignal
}

const DEFAULT_TRANSCRIPT_PAGE_LIMIT = 1_000

/**
 * Walks a session's full history without touching synced state.
 *
 * Consumers that need the whole transcript - export, copy, timeline search -
 * must not drag the entire session into `sessionDetails`, because that is the
 * memory the windowed clients work hard to bound. `fetchSessionPage` is the
 * read-only lane: it never commits, so this stays a pure read.
 */
export async function loadClientSessionTranscript(
  controller: ClientStateSyncController,
  sessionID: string,
  options: ClientSessionTranscriptOptions = {},
): Promise<ClientSessionTranscript> {
  const seen = new Set<string>()
  const pages: ClientSessionTranscriptBundle[][] = []
  let latest: OpencodeXSessionSnapshot | undefined
  let before: string | undefined
  while (true) {
    const snapshot = await controller.fetchSessionPage(sessionID, {
      limit: options.pageLimit ?? DEFAULT_TRANSCRIPT_PAGE_LIMIT,
      ...(before === undefined ? {} : { before }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
    latest ??= snapshot
    pages.unshift(snapshot.messages.items as ClientSessionTranscriptBundle[])
    if (!snapshot.messages.boundary.hasMore)
      return { messages: pages.flat(), latest, pages: pages.length }
    const cursor = snapshot.messages.boundary.next
    if (!cursor || seen.has(cursor)) throw new Error(`Session transcript pagination stalled for ${sessionID}`)
    seen.add(cursor)
    before = cursor
  }
}
