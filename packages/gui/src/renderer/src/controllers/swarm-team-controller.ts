import { createMemo, createSignal, type Accessor } from "solid-js"
import type { Session } from "@opencode-ai/sdk/v2/client"
import { mergeSessionLists } from "../lib/session-graph-fetch"
import { createStableEffect } from "../lib/stable-effect"
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
  /**
   * Delegation-tree sessions fetched outside the catalog (the workflow graph
   * controller's descendants). The catalog hides swarm-delegated children by
   * design, so without these the strip's roles would never gain a run.
   */
  extraChildren?: Accessor<readonly Session[]>
}) {
  const [memberSessionID, setMemberSessionID] = createSignal("")

  const allSessions = createMemo(() =>
    mergeSessionLists(input.authoritative.snapshot()?.sessions ?? [], input.extraChildren?.() ?? []),
  )

  const team: Accessor<SwarmTeamView | undefined> = createMemo(() => {
    const session = input.selection.selectedSession()
    const snapshot = input.authoritative.snapshot()
    if (!session || !snapshot) return undefined
    const swarm = sessionSwarm(session, snapshot.swarms)
    if (!swarm) return undefined
    return swarmTeamView({
      swarm,
      children: swarmTeamChildren(allSessions(), session.id),
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
    return allSessions().find((session) => session.id === sessionID)
  })

  // Leaving the session (or the run disappearing) closes the member view.
  // Guarded: this writes the signal it reads, and `team()` re-derives from live
  // authoritative state, so two runs disagreeing would spin the update queue.
  createStableEffect("swarmTeam.closeMissingMember", () => {
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
