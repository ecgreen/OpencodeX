import { loadClientSessionTranscript, type ClientStateSyncController } from "@opencode-ai/sdk/v2/client-sync"
import { normalizeMessageText, sessionDataFromClientState, sessionDataFromSnapshot } from "./session-data-projection"
import type { MessageBundle, SessionData } from "./store-types"

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
): Promise<SessionData> {
  const transcript = await loadClientSessionTranscript(controller, sessionID, options)
  return {
    ...sessionDataFromSnapshot(transcript.latest),
    messages: normalizeMessageText(transcript.messages as MessageBundle[]),
    ...(transcript.pages > 1 ? { messageWindowExpanded: true } : {}),
  }
}
