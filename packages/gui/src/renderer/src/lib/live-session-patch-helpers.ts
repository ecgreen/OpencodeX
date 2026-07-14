import type { Message, Part, Session } from "@opencode-ai/sdk/v2/client"
import { isRenderableSession } from "./session-filter"
import { reconcileSessionUiState } from "./session-status"
import type { GuiSnapshot, MessageBundle } from "./store"
import {
  applyPendingDeltasToPart,
  forgetPendingMessageParts,
  forgetPendingPart,
  mergePartLists,
  rememberPendingPart,
  rememberPendingPartDelta,
  takePendingParts,
  upsertPartList,
} from "./live-session-parts"

export type SessionDataPatchOptions = {
  appendMissingMessages?: boolean
}

export function stableValue<T>(current: T, next: T): T {
  return JSON.stringify(current) === JSON.stringify(next) ? current : next
}

export function upsertMessage(messages: MessageBundle[], info: Message, options: SessionDataPatchOptions = {}) {
  const index = messages.findIndex((bundle) => bundle.info.id === info.id)
  if (index < 0 && options.appendMissingMessages === false) {
    forgetPendingMessageParts(info.id)
    return messages
  }
  const pendingParts = takePendingParts(info.id)
  const next = index >= 0
    ? messages.map((bundle, i) => i === index ? { ...bundle, info, parts: mergePartLists(bundle.parts, pendingParts) } : bundle)
    : [...messages, { info, parts: pendingParts }]
  return sortMessageBundles(next)
}

export function upsertPart(messages: MessageBundle[], part: Part, options: SessionDataPatchOptions = {}) {
  const nextPart = applyPendingDeltasToPart(part)
  let found = false
  const next = messages.map((bundle) => {
    if (bundle.info.id !== nextPart.messageID) return bundle
    found = true
    forgetPendingPart(nextPart.messageID, nextPart.id)
    return { ...bundle, parts: upsertPartList(bundle.parts, nextPart) }
  })
  if (found) return next
  if (options.appendMissingMessages === false) return messages
  rememberPendingPart(nextPart)
  return messages
}

export function removePart(messages: MessageBundle[], messageID: string, partID: string) {
  return messages.map((bundle) =>
    bundle.info.id === messageID ? { ...bundle, parts: bundle.parts.filter((part) => part.id !== partID) } : bundle,
  )
}

export function applyPartDelta(
  messages: MessageBundle[],
  messageID: string,
  partID: string,
  field: string,
  delta: string,
  options: SessionDataPatchOptions = {},
) {
  if (field !== "text") {
    if (options.appendMissingMessages !== false) rememberPendingPartDelta(messageID, partID, field, delta)
    return messages
  }
  let found = false
  const next = messages.map((bundle) => {
    if (bundle.info.id !== messageID) return bundle
    return {
      ...bundle,
      parts: bundle.parts.map((part) => {
        if (part.id !== partID || (part.type !== "text" && part.type !== "reasoning")) return part
        found = true
        return { ...part, text: part.text + delta } as Part
      }),
    }
  })
  if (!found && options.appendMissingMessages !== false) rememberPendingPartDelta(messageID, partID, field, delta)
  return next
}

export function sortMessageBundles(messages: MessageBundle[]) {
  return messages.toSorted((a, b) => (a.info.time.created ?? 0) - (b.info.time.created ?? 0))
}

export function patchSnapshotSession(snapshot: GuiSnapshot, info: Session): GuiSnapshot {
  return reconcileSessionUiState(
    {
      ...snapshot,
      sessions: upsertSession(snapshot.sessions, info),
      projects: snapshot.projects.map((project) =>
        project.sessions.some((session) => session.id === info.id)
          ? { ...project, sessions: upsertSession(project.sessions, info) }
          : project,
      ),
      views: snapshot.views.map((view) =>
        view.sessions.some((session) => session.id === info.id)
          ? { ...view, sessions: upsertSession(view.sessions, info) }
          : view,
      ),
    },
    info.id,
  )
}

function upsertSession<T extends Session>(sessions: T[], session: Session): T[] {
  if (!isRenderableSession(session)) return sessions.filter((item) => item.id !== session.id)
  const index = sessions.findIndex((item) => item.id === session.id)
  const next = index >= 0 ? sessions.map((item, i) => i === index ? { ...item, ...session } : item) : [...sessions, session as T]
  return next.toSorted((a, b) => b.time.updated - a.time.updated)
}

export function upsertByID<T extends { id: string }>(items: T[], item: T) {
  return items.some((current) => current.id === item.id)
    ? items.map((current) => current.id === item.id ? item : current)
    : [...items, item]
}
