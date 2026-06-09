import type { Session } from "@opencode-ai/sdk/v2/client"
import type { SessionData } from "./store"

type SessionSyncRoute = { name: string; sessionID?: string }

export async function runSelectedSessionSync(input: {
  force?: boolean
  sessionID: string
  session?: Session
  loadedSessionID: string
  loadedTime: number
  nextRequestID: () => number
  latestRequestID: () => number
  route: () => SessionSyncRoute
  loadingSessionID: () => string
  setLoadingSessionID: (sessionID: string) => void
  clearLoadingSessionID: () => void
  loadData: (sessionID: string, directory?: string) => Promise<SessionData>
  applyData: (data: SessionData, loadedTime: number) => void
  applyFailure: (cause: unknown) => void
  now?: () => number
}) {
  if (shouldSkipSessionSync({
    force: input.force,
    sessionID: input.sessionID,
    loadedSessionID: input.loadedSessionID,
    loadedTime: input.loadedTime,
    session: input.session,
  })) return

  const requestID = input.nextRequestID()
  input.setLoadingSessionID(input.sessionID)
  try {
    const data = await input.loadData(input.sessionID, input.session?.directory)
    if (!shouldApplySessionSyncResult({ requestID, latestRequestID: input.latestRequestID(), route: input.route(), sessionID: input.sessionID })) return
    input.applyData(data, input.session?.time.updated ?? (input.now ?? Date.now)())
  } catch (cause) {
    if (shouldHandleSessionSyncFailure({ requestID, latestRequestID: input.latestRequestID() })) input.applyFailure(cause)
  } finally {
    if (shouldClearSessionSyncLoading({ requestID, latestRequestID: input.latestRequestID(), loadingSessionID: input.loadingSessionID(), sessionID: input.sessionID })) input.clearLoadingSessionID()
  }
}

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
