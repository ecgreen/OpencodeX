import { createEffect, createMemo, createSignal, type Accessor } from "solid-js"
import type { Session } from "@opencode-ai/sdk/v2/client"
import {
  sessionSwarm,
  swarmTeamChildren,
  swarmTeamView,
  teamMemberForSession,
  type SwarmTeamView,
} from "../lib/swarm-team"
import type { OpencodeXGoal } from "@opencode-ai/sdk/v2/client"
import { goalNodeForSession, sessionGoal } from "../lib/goal-graph-view"
import type { createAuthoritativeStateController } from "./authoritative-state-controller"
import type { createSessionSelectionController } from "./session-selection-controller"

/**
 * State for the swarm session's team view: the reader stays in the
 * orchestrator's session and toggles into a specialist's child session, whose
 * transcript rides the same view-session hydration the multi-pane views use.
 */
export function createSwarmTeamController(input: {
  authoritative: ReturnType<typeof createAuthoritativeStateController>
  selection: ReturnType<typeof createSessionSelectionController>
}) {
  const [memberSessionID, setMemberSessionID] = createSignal("")

  const team: Accessor<SwarmTeamView | undefined> = createMemo(() => {
    const session = input.selection.selectedSession()
    const snapshot = input.authoritative.snapshot()
    if (!session || !snapshot) return undefined
    const swarm = sessionSwarm(session, snapshot.swarms)
    if (!swarm) return undefined
    return swarmTeamView({
      swarm,
      children: swarmTeamChildren(snapshot.sessions, session.id),
      sessionStatus: snapshot.sessionStatus,
    })
  })

  /**
   * The goal this session owns. A goal supersedes the free-form team strip:
   * its nodes are the delegations, and they carry their own child sessions.
   */
  const goal: Accessor<OpencodeXGoal | undefined> = createMemo(() => {
    const snapshot = input.authoritative.snapshot()
    if (!snapshot) return undefined
    return sessionGoal(input.selection.selectedSession(), snapshot.goals)
  })

  const memberSession: Accessor<Session | undefined> = createMemo(() => {
    const sessionID = memberSessionID()
    if (!sessionID) return undefined
    return input.authoritative.snapshot()?.sessions.find((session) => session.id === sessionID)
  })

  // Leaving the session (or the run disappearing) closes the member view.
  createEffect(() => {
    const active = input.selection.activeSessionID()
    const current = memberSessionID()
    if (!current) return
    const view = team()
    const owned = goal()
    // The pane closes when its node or run disappears, or the reader leaves.
    if (owned) {
      if (!active || !goalNodeForSession(owned, current)) setMemberSessionID("")
      return
    }
    if (!active || !view || !teamMemberForSession(view, current)) setMemberSessionID("")
  })

  return {
    team,
    goal,
    memberSessionID,
    setMemberSessionID,
    memberSession,
  }
}
