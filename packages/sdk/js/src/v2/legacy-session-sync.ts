import type { OpencodeClient, OpencodeXSessionSyncResponse, OpencodeXSessionSyncSnapshot, Session } from "./client.js"
import { mergeClientSessions } from "./client-sync-session.js"

export const CLIENT_SESSION_LIST_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

export type ClientSessionSyncSnapshot = OpencodeXSessionSyncSnapshot

export type ClientSessionSyncQuery = {
  scope?: "project"
  path?: string
  roots?: boolean
  start?: number
  search?: string
  limit?: number
}

export type ClientSessionSyncResult = OpencodeXSessionSyncResponse

export type ClientSessionSyncInput = {
  client: OpencodeClient
  directory?: string
  sessionQuery?: ClientSessionSyncQuery
  since?: string
  filterSession?: (session: Session) => boolean
}

export async function loadClientSessionSync(input: ClientSessionSyncInput): Promise<ClientSessionSyncResult> {
  const response = await input.client.opencodex.session.sync(
    {
      directory: input.directory,
      scope: input.sessionQuery?.scope,
      path: input.sessionQuery?.path,
      roots: input.sessionQuery?.roots === undefined ? undefined : input.sessionQuery.roots ? "true" : "false",
      start: String(input.sessionQuery?.start ?? Date.now() - CLIENT_SESSION_LIST_WINDOW_MS),
      search: input.sessionQuery?.search,
      limit: input.sessionQuery?.limit === undefined ? undefined : String(input.sessionQuery.limit),
      since: input.since,
    },
    { throwOnError: true },
  )
  if (!response.data.changed || !input.filterSession) return response.data
  const projects = response.data.snapshot.projects.map((project) => ({
    ...project,
    sessions: project.sessions.filter((session) => input.filterSession?.(session)),
  }))
  return {
    ...response.data,
    snapshot: {
      ...response.data.snapshot,
      projects,
      sessions: mergeClientSessions(response.data.snapshot.sessions, projects, input.filterSession),
    },
  }
}
