import type { Session } from "@opencode-ai/sdk/v2/client"
import type { SessionData } from "./store-types"

/**
 * Pure decisions the session hydration controller makes: when a sync is
 * redundant, whether a late response still applies, and which loaded timestamp
 * wins. They live apart from the controller so they stay directly testable and
 * free of store wiring.
 */

export function shouldSkipSessionSync(input: {
  force?: boolean
  sessionID: string
  loadedSessionID: string
  loadedTime: number
  session?: Session
}) {
  if (input.force || input.loadedSessionID !== input.sessionID || !input.session) return false
  return input.loadedTime >= input.session.time.updated
}

export function shouldSkipViewSessionSync(input: {
  force?: boolean
  session: Session
  data?: SessionData
  loadedTime?: number
}) {
  if (input.force || !input.data) return false
  return (input.loadedTime ?? 0) >= input.session.time.updated
}

export function shouldShowViewSessionLoading(data?: SessionData) {
  return data === undefined
}

export function sessionLoadedTime(
  current: number | undefined,
  card: number | undefined,
  canonical: number | undefined,
  fallback = Date.now(),
) {
  const values = [current, card, canonical].filter((value): value is number => value !== undefined && value > 0)
  return values.length > 0 ? Math.max(...values) : fallback
}

export function shouldShowSelectedSessionLoading(input: {
  sessionID?: string
  materializingSessionID?: string
  loadedSessionID: string
  cachedData?: SessionData
}) {
  if (!input.sessionID || input.sessionID === input.materializingSessionID) return false
  return input.loadedSessionID !== input.sessionID && input.cachedData === undefined
}

export function ignoreAbortedSessionLoad<T>(load: Promise<T>) {
  return load.catch((cause) => {
    if (cause instanceof Error && cause.name === "AbortError") return undefined
    throw cause
  })
}

export function viewSessionLoadKey(session: Session) {
  return `${session.id}\n${session.directory ?? ""}\n${session.time.updated}`
}

export function shouldApplySessionSyncResult(input: {
  requestID: number
  latestRequestID: number
  route: { name: string; sessionID?: string }
  sessionID: string
}) {
  if (input.requestID !== input.latestRequestID) return false
  return input.route.name === "session" && input.route.sessionID === input.sessionID
}

export function shouldHandleSessionSyncFailure(input: { requestID: number; latestRequestID: number }) {
  return input.requestID === input.latestRequestID
}

export function shouldClearSessionSyncLoading(input: {
  requestID: number
  latestRequestID: number
  loadingSessionID: string
  sessionID: string
}) {
  return input.requestID === input.latestRequestID && input.loadingSessionID === input.sessionID
}
