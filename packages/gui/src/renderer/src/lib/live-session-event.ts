import type { GlobalEvent, OpencodeXSessionState } from "@opencode-ai/sdk/v2/client"
import type { GuiSnapshot } from "./store"

export function globalEventID(event: GlobalEvent) {
  const id = (event.payload as { id?: string }).id
  return typeof id === "string" ? id : undefined
}

export function eventAggregateID(event: GlobalEvent) {
  const id = (event.payload as { aggregateID?: string }).aggregateID
  return typeof id === "string" ? id : undefined
}

export function eventSessionID(event: GlobalEvent) {
  return sessionIDFrom(eventData(event))
}

export function globalEventSessionStatus(event: GlobalEvent) {
  const kind = eventKind(event)
  if (kind === "session.idle") {
    const sessionID = eventSessionID(event)
    return sessionID ? { sessionID, status: { type: "idle" } as GuiSnapshot["sessionStatus"][string], syncVisible: true } : undefined
  }

  if (kind !== "session.status") return
  const properties = eventData(event)
  if (!isRecordValue(properties) || typeof properties.sessionID !== "string" || !isSessionStatus(properties.status)) return
  return { sessionID: properties.sessionID, status: properties.status, syncVisible: true }
}

export function globalEventSessionState(event: GlobalEvent) {
  if (eventKind(event) !== "opencodex.session_state.updated") return
  const properties = eventData(event)
  if (!isRecordValue(properties) || typeof properties.sessionID !== "string" || !isRecordValue(properties.state)) return
  return { sessionID: properties.sessionID, state: properties.state as OpencodeXSessionState }
}

export function eventMessageID(event: GlobalEvent) {
  return messageIDFrom(eventData(event))
}

export function eventKind(event: GlobalEvent) {
  const payload = event.payload as { type: string; name?: string }
  return payload.type === "sync" && payload.name ? payload.name.replace(/\.\d+$/, "") : payload.type
}

export function eventData(event: GlobalEvent) {
  const payload = event.payload as { properties?: Record<string, unknown>; data?: Record<string, unknown> }
  return payload.properties ?? payload.data
}

function sessionIDFrom(value: unknown) {
  if (!isRecordValue(value)) return
  if (typeof value.sessionID === "string") return value.sessionID
  if (isRecordValue(value.info) && typeof value.info.sessionID === "string") return value.info.sessionID
  if (isRecordValue(value.part) && typeof value.part.sessionID === "string") return value.part.sessionID
}

function messageIDFrom(value: unknown) {
  if (!isRecordValue(value)) return
  if (typeof value.messageID === "string") return value.messageID
  if (isRecordValue(value.info) && typeof value.info.id === "string") return value.info.id
  if (isRecordValue(value.part) && typeof value.part.messageID === "string") return value.part.messageID
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isSessionStatus(value: unknown): value is GuiSnapshot["sessionStatus"][string] {
  return isRecordValue(value) && typeof value.type === "string"
}
