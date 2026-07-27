import type { OpencodeXSessionCardPage, Session } from "./client.js"
import type { ClientEntityState, ClientStateSyncState } from "./client-sync-types.js"

export function applyClientSessionCardPage(
  current: ClientStateSyncState,
  page: OpencodeXSessionCardPage,
  options: { pagination?: boolean; root?: boolean } = {},
): ClientStateSyncState {
  const missing = new Set(page.missing)
  const records = { ...current.sessions.records }
  page.items.forEach((item) => {
    records[item.id] = stable(records[item.id], item)
  })
  missing.forEach((sessionID) => delete records[sessionID])
  const ids = Object.values(records)
    .sort((left, right) => right.time.updated - left.time.updated || right.id.localeCompare(left.id))
    .map((session) => session.id)
  const sessions = {
    ids: equal(current.sessions.ids, ids) ? current.sessions.ids : ids,
    records: sameRecord(current.sessions.records, records) ? current.sessions.records : records,
  }
  const projects = mapEntities(current.projects, (project) => {
    const sessionIDs = project.sessionIDs.filter((sessionID) => !missing.has(sessionID))
    return sessionIDs.length === project.sessionIDs.length ? project : { ...project, sessionIDs }
  })
  const views = mapEntities(current.views, (view) => {
    const sessionIDs = view.sessionIDs.filter((sessionID) => !missing.has(sessionID))
    // members must be pruned in the same pass: a view holding evicted session
    // ids in members would 400 on the next membership PATCH built from it.
    const members = (view.members ?? []).filter((member) => member.kind !== "session" || !missing.has(member.id))
    if (sessionIDs.length === view.sessionIDs.length && members.length === (view.members ?? []).length) return view
    return {
      ...view,
      sessionIDs,
      members,
      focusedSessionID:
        view.focusedSessionID && sessionIDs.includes(view.focusedSessionID) ? view.focusedSessionID : sessionIDs[0],
      focusedItemID:
        view.focusedItemID && members.some((member) => member.id === view.focusedItemID)
          ? view.focusedItemID
          : members[0]?.id,
    }
  })
  const messageIDs = Object.keys(current.tombstones.messageSessions).filter((messageID) =>
    missing.has(current.tombstones.messageSessions[messageID]),
  )
  const partIDs = Object.keys(current.tombstones.partSessions).filter((partID) =>
    missing.has(current.tombstones.partSessions[partID]),
  )
  const sessionUiState = removeKeys(mergeRecords(current.sessionUiState, page.sessionUiState), page.missing)
  return {
    ...current,
    projects,
    sessions,
    views,
    sessionCards: options.root
      ? {
          next: page.next,
          hasMore: page.hasMore,
          pages: 1,
          loading: false,
        }
      : options.pagination
        ? {
            next: page.next,
            hasMore: page.hasMore,
            pages: current.sessionCards.pages + 1,
            loading: false,
          }
        : current.sessionCards,
    sessionDetails: removeKeys(current.sessionDetails, page.missing),
    sessionLoads: removeKeys(current.sessionLoads, page.missing),
    dirtySessions: removeKeys(current.dirtySessions, page.missing),
    sessionStatus: removeKeys(current.sessionStatus, page.missing),
    sessionUiState,
    permissions: filterEntities(current.permissions, (item) => !missing.has(item.sessionID)),
    questions: filterEntities(current.questions, (item) => !missing.has(item.sessionID)),
    tombstones: {
      ...current.tombstones,
      sessions: page.missing.reduce(
        (result, sessionID) => ({ ...result, [sessionID]: true as const }),
        removeKeys(
          current.tombstones.sessions,
          page.items.map((item) => item.id),
        ),
      ),
      messages: removeKeys(current.tombstones.messages, messageIDs),
      parts: removeKeys(current.tombstones.parts, partIDs),
      messageSessions: removeKeys(current.tombstones.messageSessions, messageIDs),
      partSessions: removeKeys(current.tombstones.partSessions, partIDs),
    },
  }
}

export function isClientSessionRenderable(session: Session) {
  if (session.time.archived !== undefined) return false
  const metadata = session.metadata
  if (!isRecord(metadata) || !isRecord(metadata.opencodex)) return true
  return metadata.opencodex.swarmID === undefined
}

function mapEntities<T>(current: ClientEntityState<T>, map: (item: T) => T) {
  const records = Object.fromEntries(
    current.ids.flatMap((id) => {
      const item = current.records[id]
      return item ? [[id, map(item)]] : []
    }),
  )
  return sameRecord(current.records, records) ? current : { ...current, records }
}

function filterEntities<T>(current: ClientEntityState<T>, keep: (item: T) => boolean) {
  const ids = current.ids.filter((id) => {
    const item = current.records[id]
    return item ? keep(item) : false
  })
  if (ids.length === current.ids.length) return current
  return {
    ids,
    records: Object.fromEntries(
      ids.flatMap((id) => {
        const item = current.records[id]
        return item ? [[id, item]] : []
      }),
    ),
  }
}

function removeKeys<T>(record: Record<string, T>, keys: readonly string[]) {
  if (keys.length === 0) return record
  const removed = new Set(keys)
  const entries = Object.entries(record).filter(([key]) => !removed.has(key))
  return entries.length === Object.keys(record).length ? record : Object.fromEntries(entries)
}

function mergeRecords<T>(current: Record<string, T>, incoming: Record<string, T>) {
  const entries = Object.entries(incoming)
  if (entries.length === 0) return current
  const next = { ...current }
  entries.forEach(([key, value]) => {
    next[key] = stable(current[key], value)
  })
  return sameRecord(current, next) ? current : next
}

function sameRecord<T>(current: Record<string, T>, next: Record<string, T>) {
  const keys = Object.keys(next)
  return keys.length === Object.keys(current).length && keys.every((key) => current[key] === next[key])
}

function stable<T>(current: T | undefined, next: T): T {
  return current !== undefined && equal(current, next) ? current : next
}

function equal(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (typeof left !== typeof right || left === null || right === null) return false
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
    return left.every((value, index) => equal(value, right[index]))
  }
  if (!isRecord(left) || !isRecord(right)) return false
  const keys = Object.keys(left)
  return keys.length === Object.keys(right).length && keys.every((key) => equal(left[key], right[key]))
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input)
}
