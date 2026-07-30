import type { Event, GlobalEvent, OpencodeXSessionState } from "@opencode-ai/sdk/v2/client"
import { clientGlobalEventData, clientGlobalEventKind } from "@opencode-ai/sdk/v2/client-sync"
import type { GuiSnapshot } from "./session-api"

export function globalEventID(event: GlobalEvent) {
  const id = (event.payload as { id?: string }).id
  return typeof id === "string" ? id : undefined
}

export function globalEventPayload(event: GlobalEvent): Event | undefined {
  const id = globalEventID(event)
  const properties = eventData(event)
  if (!id || !properties) return undefined
  // The generated GlobalEvent union correlates payload names and data, but that correlation is lost by sync normalization.
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
  return { id, type: eventKind(event), properties } as Event
}

export function eventAggregateID(event: GlobalEvent) {
  if (!("aggregateID" in event.payload)) return undefined
  const id = event.payload.aggregateID
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

  if (kind !== "session.status") return undefined
  const properties = eventData(event)
  if (!isRecordValue(properties) || typeof properties.sessionID !== "string" || !isSessionStatus(properties.status))
    return undefined
  return { sessionID: properties.sessionID, status: properties.status, syncVisible: true }
}

export function globalEventSessionState(event: GlobalEvent) {
  if (eventKind(event) !== "opencodex.session_state.updated") return undefined
  const properties = eventData(event)
  if (!isRecordValue(properties) || typeof properties.sessionID !== "string" || !isSessionState(properties.state))
    return undefined
  return { sessionID: properties.sessionID, state: properties.state }
}

export function eventMessageID(event: GlobalEvent) {
  return messageIDFrom(eventData(event))
}

/** Delegates to the shared envelope normalizer so both clients unwrap sync frames identically. */
export function eventKind(event: GlobalEvent) {
  return clientGlobalEventKind(event.payload)
}

/** Delegates to the shared envelope normalizer so both clients unwrap sync frames identically. */
export function eventData(event: GlobalEvent) {
  return clientGlobalEventData(event.payload)
}

function sessionIDFrom(value: unknown) {
  if (!isRecordValue(value)) return undefined
  if (typeof value.sessionID === "string") return value.sessionID
  if (isRecordValue(value.info) && typeof value.info.sessionID === "string") return value.info.sessionID
  if (isRecordValue(value.part) && typeof value.part.sessionID === "string") return value.part.sessionID
  return undefined
}

function messageIDFrom(value: unknown) {
  if (!isRecordValue(value)) return undefined
  if (typeof value.messageID === "string") return value.messageID
  if (isRecordValue(value.info) && typeof value.info.id === "string") return value.info.id
  if (isRecordValue(value.part) && typeof value.part.messageID === "string") return value.part.messageID
  return undefined
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isSessionStatus(value: unknown): value is GuiSnapshot["sessionStatus"][string] {
  return isRecordValue(value) && typeof value.type === "string"
}

function isSessionState(value: unknown): value is OpencodeXSessionState {
  return (
    isRecordValue(value) &&
    typeof value.sessionID === "string" &&
    (value.seenAt === undefined || typeof value.seenAt === "number") &&
    (value.reviewedAt === undefined || typeof value.reviewedAt === "number") &&
    Array.isArray(value.reviewedFiles) &&
    value.reviewedFiles.every((file) => typeof file === "string") &&
    typeof value.timeUpdated === "number"
  )
}
