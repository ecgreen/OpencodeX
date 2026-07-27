import type { Session } from "@opencode-ai/sdk/v2/client"
import {
  clientSessionOrderBucketForStatus,
  emptyClientSessionOrderState,
  orderClientSessionItems,
  projectClientSessionItems,
  recentClientSessionModels,
  reconcileClientSessionOrderState,
  type ClientSessionOrderBucket,
  type ClientSessionOrderInput,
  type ClientSessionOrderState,
} from "@opencode-ai/sdk/v2/session-order"
import type { GuiSnapshot } from "./store"
import { modelValue } from "./model-selection"
import { deriveSessionStatus } from "./session-status"
import { isRenderableSession } from "./session-filter"

export type SessionOrderBucket = ClientSessionOrderBucket
export type SessionOrderState = ClientSessionOrderState
export type SessionOrderItem = ClientSessionOrderInput & { session: Session }

export function emptySessionOrderState() {
  return emptyClientSessionOrderState()
}

export function reconcileSessionOrderState(state: SessionOrderState, snapshot?: GuiSnapshot) {
  return reconcileClientSessionOrderState(state, tuiSidebarSessionOrderItems(snapshot))
}

export function tuiSidebarSessionOrderItems(snapshot?: GuiSnapshot): SessionOrderItem[] {
  return (snapshot?.sessions ?? []).filter(isTUISidebarSession).map((session) => sessionOrderItem(snapshot, session))
}

export function tuiSidebarSessions(snapshot?: GuiSnapshot, state?: SessionOrderState) {
  return orderSessionItems(tuiSidebarSessionOrderItems(snapshot), state).map((item) => item.session)
}

export function projectSessions(project: GuiSnapshot["projects"][number], snapshot?: GuiSnapshot, state?: SessionOrderState) {
  const byID = new Map(tuiSidebarSessions(snapshot, state).map((session) => [session.id, session]))
  const embedded = new Map(project.sessions.map((session) => [session.id, session]))
  return orderSessionItems(project.sessionIDs
    .flatMap((sessionID) => byID.get(sessionID) ?? embedded.get(sessionID) ?? [])
    .filter(isTUISidebarSession)
    .map((session) => sessionOrderItem(snapshot, session)), state).map((item) => item.session)
}

export function projectSessionPreviewItems(sessions: readonly Session[], snapshot?: GuiSnapshot, state?: SessionOrderState) {
  const items = sessions.map((session) => sessionOrderItem(snapshot, session))
  return projectClientSessionItems(items, sessionOrderStateFor(items, state)).map((item) => item.session)
}

export function orderSessions(snapshot: GuiSnapshot | undefined, sessions: readonly Session[], state?: SessionOrderState) {
  return orderSessionItems(sessions.map((session) => sessionOrderItem(snapshot, session)), state).map((item) => item.session)
}

export function sessionOrderBucket(snapshot: GuiSnapshot | undefined, session: Session): SessionOrderBucket {
  return clientSessionOrderBucketForStatus(deriveSessionStatus(snapshot, session))
}

export function recentModelsFromSessions(sessions: Session[]) {
  return mergeRecentModels(
    recentClientSessionModels(
      sessions,
      (session) => session.model ? modelValue(session.model.providerID, session.model.id) : undefined,
      (session) => session.time.updated,
    ),
  )
}

export function mergeRecentModels(...groups: string[][]) {
  return Array.from(new Set(groups.flat().filter(Boolean))).slice(0, 10)
}

function isTUISidebarSession(session: Session) {
  return !session.parentID && !isSwarmSession(session) && isRenderableSession(session)
}

function isSwarmSession(session: Session) {
  const opencodex = session.metadata?.opencodex
  return typeof opencodex === "object" && opencodex !== null && "swarmID" in opencodex && typeof opencodex.swarmID === "string"
}

function orderSessionItems(items: readonly SessionOrderItem[], state?: SessionOrderState) {
  return orderClientSessionItems(items, sessionOrderStateFor(items, state))
}

function sessionOrderStateFor(items: readonly SessionOrderItem[], state?: SessionOrderState) {
  return state ?? reconcileClientSessionOrderState(emptyClientSessionOrderState(), items)
}

function sessionOrderItem(snapshot: GuiSnapshot | undefined, session: Session): SessionOrderItem {
  return {
    id: session.id,
    bucket: sessionOrderBucket(snapshot, session),
    timeUpdated: session.time.updated,
    timeCreated: session.time.created,
    session,
  }
}
