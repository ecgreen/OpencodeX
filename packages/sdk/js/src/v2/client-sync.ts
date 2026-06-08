import type {
  GlobalSession,
  OpencodeClient,
  OpencodeXProject,
  OpencodeXSessionState,
  OpencodeXSessionSyncResponse,
  OpencodeXSessionSyncSnapshot,
  Session,
} from "./client.js"

export const CLIENT_SESSION_SYNC_INTERVAL_MS = 500
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

export type ClientSessionStateUpdate = {
  seenAt?: number
  reviewedAt?: number
  reviewedFiles?: readonly string[]
}

export type ClientSessionSyncInput = {
  client: OpencodeClient
  directory?: string
  sessionQuery?: ClientSessionSyncQuery
  since?: string
  statusWorkspaces?: readonly (string | undefined)[]
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

export async function updateClientSessionState(
  client: OpencodeClient,
  sessionID: string,
  input: ClientSessionStateUpdate,
): Promise<OpencodeXSessionState> {
  return (
    await client.opencodex.sessionState.update(
      {
        sessionID,
        seenAt: input.seenAt,
        reviewedAt: input.reviewedAt,
        reviewedFiles: input.reviewedFiles ? [...input.reviewedFiles] : undefined,
      },
      { throwOnError: true },
    )
  ).data
}

export function mergeClientSessions(
  sessions: readonly (Session | GlobalSession)[],
  projects: readonly OpencodeXProject[],
  filterSession?: (session: Session) => boolean,
): Session[] {
  return Array.from(
    new Map(
      [...sessions, ...projects.flatMap((project) => project.sessions as Session[])]
        .filter((session) => filterSession?.(session) ?? true)
        .map((session): [string, Session] => [session.id, session]),
    ).values(),
  ).sort((a, b) => b.time.updated - a.time.updated)
}

export function isRenderableClientSession(session: Session) {
  if (session.parentID) return true
  if (session.model || session.summary || session.share || session.revert) return true
  const tokens = session.tokens
  if (tokens && tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write > 0)
    return true
  if ((session.cost ?? 0) > 0) return true
  return !isPlaceholderTitle(session.title)
}

function isPlaceholderTitle(title: string) {
  return title === "New session" || /^New session - \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(title)
}
