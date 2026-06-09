import type { Session } from "@opencode-ai/sdk/v2/client"
import type { GuiSnapshot } from "./store"

export async function runCreateSwarmAction(input: {
  projects: GuiSnapshot["projects"]
  alert: (message: string) => void
  chooseProjectID: (projects: GuiSnapshot["projects"]) => Promise<string | undefined>
  createSwarm: (projectID: string, title: string, prompt: string) => Promise<void>
  refresh: () => Promise<void>
  openSwarms: () => void
}) {
  if (input.projects.length === 0) return input.alert("Create or load a project before creating a swarm.")
  const projectID = await input.chooseProjectID(input.projects)
  if (!projectID) return
  await input.createSwarm(projectID, "New swarm", "")
  await input.refresh()
  input.openSwarms()
}

export async function runCreateViewAction(input: {
  sessions: Session[]
  alert: (message: string) => void
  chooseSessionIDs: (sessions: Session[]) => Promise<string[]>
  createView: (title: string, sessionIDs: string[]) => Promise<void>
  refresh: () => Promise<void>
  openViews: () => void
}) {
  if (input.sessions.length === 0) return input.alert("Create or load at least one session before creating a view.")
  const sessionIDs = await input.chooseSessionIDs(input.sessions)
  if (sessionIDs.length === 0) return
  await input.createView("New view", sessionIDs)
  await input.refresh()
  input.openViews()
}

export async function runCreateProjectSessionAction(input: {
  projects: GuiSnapshot["projects"]
  alert: (message: string) => void
  chooseProjectID: (projects: GuiSnapshot["projects"]) => Promise<string | undefined>
  createSession: (projectID: string, directory?: string) => void | Promise<void>
}) {
  if (input.projects.length === 0) return input.alert("Create or load a project before creating a project session.")
  const projectID = await input.chooseProjectID(input.projects)
  const project = input.projects.find((item) => item.id === projectID)
  if (project) await input.createSession(project.id, project.folders[0]?.path)
}
