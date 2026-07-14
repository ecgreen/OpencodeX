import type { Session } from "@opencode-ai/sdk/v2/client"
import type { GuiSnapshot } from "./store"

export function projectNameForID(projects: GuiSnapshot["projects"], projectID?: string) {
  const project = projects.find((item) => item.id === projectID)
  return project?.name ?? project?.project.name
}

export function projectNameForSession(projects: GuiSnapshot["projects"], session?: Session) {
  if (!session) return
  const project = projects.find(
    (item) => item.id === session.projectID || item.sessions.some((candidate) => candidate.id === session.id),
  )
  return project?.name ?? project?.project.name
}
