import type { GlobalSession, OpencodeClient, OpencodeXProject, OpencodeXSessionState, Session } from "./client.js"

export type ClientSessionStateUpdate = {
  seenAt?: number
  reviewedAt?: number
  reviewedFiles?: readonly string[]
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
