import type { OpencodeXSwarm, Session } from "@opencode-ai/sdk/v2/client"
import type { GuiSnapshot } from "./store-types"

/**
 * The swarm team as the session page presents it: the user talks to the
 * orchestrator, and every specialist's work happens in child sessions the team
 * strip lets them toggle into.
 */

export type SwarmTeamRun = {
  id: string
  title: string
  updated: number
  busy: boolean
}

export type SwarmTeamMember = {
  key: string
  name: string
  description?: string
  busy: boolean
  runs: SwarmTeamRun[]
}

export type SwarmTeamView = {
  swarmID: string
  title: string
  members: SwarmTeamMember[]
}

/** The swarm a session runs on, when its model routes to the swarm facade. */
export function sessionSwarm(session: Session | undefined, swarms: readonly OpencodeXSwarm[]) {
  const swarmID = session ? sessionModelSwarmID(session) : undefined
  if (!swarmID) return undefined
  return swarms.find((swarm) => swarm.id === swarmID)
}

export function sessionModelSwarmID(session: Session) {
  return session.model?.providerID === "swarm" ? session.model.id : undefined
}

/**
 * Groups a swarm session's child sessions under the specialist roles that ran
 * them. Delegations tag children with the role name; older or task-tool
 * children fall back to title matching, and anything else lands in a trailing
 * "Other agents" bucket so no work is hidden.
 */
export function swarmTeamView(input: {
  swarm: OpencodeXSwarm
  children: readonly Session[]
  sessionStatus: GuiSnapshot["sessionStatus"]
}): SwarmTeamView {
  const specialists = input.swarm.roles.slice(1)
  const buckets = new Map<string, Session[]>(specialists.map((role) => [normalizeRoleName(role.name), []]))
  const other: Session[] = []
  for (const child of input.children) {
    const key = childRoleKey(child, buckets)
    if (key) buckets.get(key)!.push(child)
    else other.push(child)
  }
  const members = specialists.map((role): SwarmTeamMember => {
    const runs = teamRuns(buckets.get(normalizeRoleName(role.name)) ?? [], input.sessionStatus)
    return {
      key: normalizeRoleName(role.name),
      name: role.name,
      description: role.skill ?? role.agent ?? undefined,
      busy: runs.some((run) => run.busy),
      runs,
    }
  })
  if (other.length > 0) {
    const runs = teamRuns(other, input.sessionStatus)
    members.push({ key: "::other", name: "Other agents", busy: runs.some((run) => run.busy), runs })
  }
  return { swarmID: input.swarm.id, title: input.swarm.title, members }
}

export function swarmTeamChildren(sessions: readonly Session[], parentID: string) {
  return sessions.filter((session) => session.parentID === parentID)
}

/** The run the strip opens first: the one still working, else the newest. */
export function defaultTeamRun(member: SwarmTeamMember) {
  return member.runs.find((run) => run.busy) ?? member.runs[0]
}

export function teamMemberForSession(view: SwarmTeamView, sessionID: string) {
  return view.members.find((member) => member.runs.some((run) => run.id === sessionID))
}

function teamRuns(sessions: readonly Session[], status: GuiSnapshot["sessionStatus"]): SwarmTeamRun[] {
  return sessions
    .toSorted((a, b) => b.time.updated - a.time.updated)
    .map((session) => ({
      id: session.id,
      title: cleanRunTitle(session.title),
      updated: session.time.updated,
      busy: isBusyStatus(status[session.id]?.type),
    }))
}

function isBusyStatus(status: string | undefined) {
  return status === "busy" || status === "retry"
}

function childRoleKey(child: Session, buckets: ReadonlyMap<string, Session[]>) {
  const tagged = sessionSwarmRole(child)
  if (tagged && buckets.has(normalizeRoleName(tagged))) return normalizeRoleName(tagged)
  const title = normalizeRoleName(child.title)
  for (const key of buckets.keys()) if (key && title.includes(key)) return key
  return undefined
}

/** Role recorded on a delegated child session; see prompt.ts runSwarmRole. */
export function sessionSwarmRole(session: Session) {
  const opencodex = session.metadata?.opencodex
  if (typeof opencodex !== "object" || opencodex === null || !("swarmRole" in opencodex)) return undefined
  const role = (opencodex as { swarmRole?: unknown }).swarmRole
  return typeof role === "string" ? role : undefined
}

/** Strips the bookkeeping suffixes server-created child titles carry. */
function cleanRunTitle(title: string) {
  return title.replace(/\s*\((swarm role|@[\w-]+ subagent)\)\s*$/i, "").trim() || title
}

/** Mirrors the server's lenient role matching (SwarmBriefing.matchSwarmRole). */
function normalizeRoleName(value: string) {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, "")
}
