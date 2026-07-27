export type AbortConfirmResult = "abort" | "confirm"

// Guards destructive single-Escape aborts: the first request arms a short
// confirmation window, and only a second request inside it aborts.
export function createAbortConfirmGate(input: { windowMs?: number; now?: () => number } = {}) {
  const windowMs = input.windowMs ?? 1500
  const now = input.now ?? Date.now
  let armedSessionID = ""
  let expiresAt = 0

  function request(sessionID: string): AbortConfirmResult {
    const at = now()
    if (armedSessionID === sessionID && at <= expiresAt) {
      disarm()
      return "abort"
    }
    armedSessionID = sessionID
    expiresAt = at + windowMs
    return "confirm"
  }

  function disarm() {
    armedSessionID = ""
    expiresAt = 0
  }

  return { request, disarm }
}
