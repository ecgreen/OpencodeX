import { SwarmBriefing } from "./swarm-briefing"
import type { Executor, NodeKind } from "./goal-schema"

/**
 * Turning a node's executor into the concrete things a turn needs: a model, an
 * agent, a skill to load, and standing instructions. This is the seam where
 * swarms stop being special - a swarm role and a bare model resolve into the
 * same shape, so the dispatcher below never branches on which kind of goal it
 * is running.
 */

export type SwarmRoleRow = {
  readonly name: string
  readonly agent?: string | null
  readonly skill?: string | null
  readonly instructions?: string | null
  readonly provider_id?: string | null
  readonly model_id?: string | null
  /** The model variant (effort level) the role runs at, when one is chosen. */
  readonly variant?: string | null
}

export type ResolvedExecutor = {
  readonly label: string
  readonly providerID?: string
  readonly modelID?: string
  /** The model variant (effort level) the node runs at. */
  readonly variant?: string
  readonly agent?: string
  /** Skill id whose body is prefixed to the prompt; resolved by the caller. */
  readonly skill?: string
  readonly instructions?: string
  /** The swarm role this ran as, recorded on the child session for the team view. */
  readonly roleName?: string
}

export type ResolveInput = {
  readonly executor?: Executor
  readonly kind: NodeKind
  readonly roles?: readonly SwarmRoleRow[]
  /** The goal's model, used where an executor does not name its own. */
  readonly fallback?: { readonly providerID?: string; readonly modelID?: string }
}

export type ResolveResult = { readonly executor: ResolvedExecutor } | { readonly error: string }

export function resolveExecutor(input: ResolveInput): ResolveResult {
  const executor = input.executor
  if (!executor) return { error: `A ${input.kind} node needs an executor.` }
  if (executor.type === "swarm_role") {
    const role = SwarmBriefing.matchSwarmRole(input.roles ?? [], executor.role)
    if (!role) {
      const available = (input.roles ?? []).map((item) => item.name).join(", ")
      return { error: `Unknown swarm role "${executor.role}".${available ? ` Available: ${available}.` : ""}` }
    }
    const providerID = role.provider_id ?? input.fallback?.providerID
    const modelID = role.model_id ?? input.fallback?.modelID
    if (!providerID || !modelID) return { error: `Swarm role "${role.name}" has no model configured.` }
    return {
      executor: {
        label: role.name,
        roleName: role.name,
        providerID,
        modelID,
        variant: role.variant ?? undefined,
        agent: role.agent ?? undefined,
        skill: role.skill ?? undefined,
        instructions: role.instructions?.trim() || undefined,
      },
    }
  }
  const providerID = executor.providerID ?? input.fallback?.providerID
  const modelID = executor.modelID ?? input.fallback?.modelID
  if (!providerID || !modelID) {
    return { error: "No model available for this node: name one on the executor or give the goal a default." }
  }
  return {
    executor: {
      label: executor.type === "agent" ? executor.agent : (executor.skill ?? modelID),
      providerID,
      modelID,
      ...(executor.type === "agent" ? { agent: executor.agent } : {}),
      skill: executor.skill,
      instructions: executor.instructions?.trim() || undefined,
    },
  }
}

export * as GoalExecutor from "./goal-executor"
