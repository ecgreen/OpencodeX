import type { ClientSessionOrderInput } from "@opencode-ai/sdk/v2/session-order"
import type { useSync } from "@tui/context/sync"
import type { DerivedStatus } from "./opencodex-session-status"

export type OpencodeXProject = {
  id: string
  name?: string
  project: {
    id: string
    name?: string
    worktree: string
  }
  folders?: { path: string }[]
  sessions: ReturnType<typeof useSync>["data"]["session"]
  sessionIDs: string[]
}

export type DashboardSession = ReturnType<typeof useSync>["data"]["session"][number]
export type DashboardStatus = DerivedStatus | "review_ready" | "unviewed"
export type DashboardRowKind = "session" | "swarm" | "view"

export type DashboardRow = {
  id: string
  kind: DashboardRowKind
  title: string
  subtitle?: string
  projectID?: string
  status: string
  dashboardStatus?: DashboardStatus
  reason?: string
  timeUpdated: number
  source?: string
  session?: DashboardSession
  swarm?: OpencodeXSwarm
  view?: OpencodeXView
  open: () => void
}

export type DashboardSessionOrderItem = ClientSessionOrderInput & { row: DashboardRow & { session: DashboardSession } }

export type DashboardProjectSummary = {
  project: OpencodeXProject
  rows: DashboardRow[]
  sessionCount: number
  swarmCount: number
  lastUpdated: number
}

export type OpencodeXSwarmRole = {
  id: string
  name: string
  status: string
  agent?: string
  skill?: string
  instructions: string
  providerID?: string
  modelID?: string
  modelProfile?: string
  sessionID?: string
  currentSessionID?: string
  sessionIDs?: string[]
  jobID?: string
  timeCreated?: number
  timeUpdated?: number
}

export type OpencodeXSwarm = {
  id: string
  projectID: string
  title: string
  prompt: string
  status: string
  source: string
  synthesisSessionID?: string
  roles: OpencodeXSwarmRole[]
  events: {
    id: string
    kind: string
    message: string
    roleID?: string
    timeCreated: number
  }[]
  timeCreated: number
  timeUpdated: number
}

export type OpencodeXView = {
  id: string
  title: string
  sessionIDs: string[]
  focusedSessionID?: string
  timeUpdated: number
}

export type DashboardItem =
  | { id: string; kind: "section"; action: () => void }
  | { id: string; kind: "item"; action: () => void }

export type SwarmRolePreset = {
  name: string
  skill: string
  description: string
  selected?: boolean
}

export type SwarmRoleDraft = SwarmRolePreset & {
  draftID: string
  selected?: boolean
  customInstructions: string
  providerID?: string
  modelID?: string
  existing?: boolean
}

export type ModelSelection = {
  providerID: string
  modelID: string
}
