import type { Session } from "@opencode-ai/sdk/v2/client"

type RouteLike = { name: string; sessionID?: string }

export type VisibleSessionSyncTarget = { type: "session"; sessionID: string } | { type: "view"; session: Session }

export function visibleSessionSyncTarget(input: {
  route: RouteLike
  sessionID: string
  viewSessions: Session[]
}): VisibleSessionSyncTarget | undefined {
  if (input.route.name === "session" && input.route.sessionID === input.sessionID) {
    return { type: "session", sessionID: input.sessionID }
  }
  if (input.route.name !== "views") return undefined
  const session = input.viewSessions.find((item) => item.id === input.sessionID)
  return session ? { type: "view", session } : undefined
}
