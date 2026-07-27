import {
  CLIENT_PROJECT_RECENT_SESSION_LIMIT,
  isRecentClientSessionUpdate,
  projectClientSessionItems,
  type ClientSessionOrderInput,
  type ClientSessionOrderState,
} from "@opencode-ai/sdk/v2/session-order"

export function isRecentSessionUpdate(timeUpdated: number, now = Date.now()) {
  return isRecentClientSessionUpdate(timeUpdated, now)
}

export function recentProjectItems<T extends ClientSessionOrderInput>(
  items: readonly T[],
  state: ClientSessionOrderState,
  now = Date.now(),
) {
  return projectClientSessionItems(items, state, now, CLIENT_PROJECT_RECENT_SESSION_LIMIT)
}
