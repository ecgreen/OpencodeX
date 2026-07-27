import type { ClientStateSyncController } from "@opencode-ai/sdk/v2/client-sync"
import { prependOlderMessages } from "./message-window"
import { sessionDataFromClientState, sessionDataFromSnapshot } from "./session-data-projection"
import type { SessionData } from "./store-types"

export async function refreshClientStateSessionTail(
  controller: ClientStateSyncController,
  sessionID: string,
  options: { limit?: number; signal?: AbortSignal } = {},
  current?: SessionData,
) {
  await controller.refreshSessionTail(sessionID, options)
  const data = sessionDataFromClientState(controller.getState(), sessionID, current)
  if (!data) throw new Error(`Authoritative session snapshot missing for ${sessionID}`)
  return data
}

export async function fetchClientStateSessionPage(
  controller: ClientStateSyncController,
  sessionID: string,
  options: { limit?: number; before?: string; signal?: AbortSignal } = {},
) {
  return sessionDataFromSnapshot(await controller.fetchSessionPage(sessionID, options))
}

export async function loadClientStateSessionTranscript(
  controller: ClientStateSyncController,
  sessionID: string,
  options: { pageLimit?: number; signal?: AbortSignal } = {},
) {
  const cursors = new Set<string>()
  let before: string | undefined
  let data: SessionData | undefined
  while (true) {
    const snapshot = await controller.fetchSessionPage(sessionID, {
      limit: options.pageLimit ?? 1_000,
      before,
      signal: options.signal,
    })
    const page = sessionDataFromSnapshot(snapshot)
    data = data ? prependOlderMessages(data, { messages: page.messages, cursor: page.messageCursor }) : page
    if (!snapshot.messages.boundary.hasMore) return data
    const cursor = snapshot.messages.boundary.next
    if (!cursor || cursors.has(cursor)) throw new Error(`Session transcript pagination stalled for ${sessionID}`)
    cursors.add(cursor)
    before = cursor
  }
}
