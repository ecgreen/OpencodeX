import { Cause, Effect } from "effect"
import {
  finalizeAbandonedTurn,
  initialState,
  mapEvent,
  type ClaudeEvent,
  type MapperContext,
  type MapperState,
  type SessionWrite,
} from "./claude-mapper"

/**
 * Claude runs subagents as sidechains: the same event stream, tagged with
 * `parent_tool_use_id`. Untagged events belong to the main conversation.
 * This router projects each sidechain into its own child session so the
 * session graph and transcript show subagents instead of dropping them (or
 * leaking their output into the main transcript).
 *
 * Pure state machine: it returns actions; the driver interprets them with
 * effects (session creation, write application).
 */

export type SidechainAction =
  | { kind: "spawn"; chainID: string; title: string; prompt: string }
  | { kind: "writes"; chainID: string; sessionID: string; writes: SessionWrite[] }

type Chain = {
  state: MapperState
  context?: MapperContext
  /** Events seen before the child session exists; replayed on attachChild. */
  pending: ClaudeEvent[]
  done: boolean
}

export type SidechainRouter = ReturnType<typeof createSidechainRouter>

/**
 * A sidechain spawn failing must not kill the main turn - it should simply
 * skip that one subagent. The spawn capability's declared error type is
 * `never` (callers wrap their own errors in `Effect.orDie`, e.g.
 * prompt-swarm.ts's `sessions.create`/`prompt` calls), so a real failure
 * surfaces as a defect, not a typed error: a plain `Effect.catch`/
 * `Effect.catchAll` handler - which only inspects the typed error channel -
 * never runs, and the defect sails through, killing the whole turn before
 * `finalize`/`saveConversation` get a chance to run.
 *
 * `Effect.catchCause` recovers from the entire `Cause` - typed failures and
 * defects alike - which is what "catches both" requires. The one thing it
 * must NOT recover from is genuine fiber interruption (the turn being
 * aborted): swallowing that would stop the abort from actually propagating
 * up through the driver's event loop, so an interrupted cause is re-raised
 * via `Effect.failCause` instead of being turned into a value.
 */
export function recoverSpawnFailure<A, R>(effect: Effect.Effect<A, never, R>): Effect.Effect<A | undefined, never, R> {
  return effect.pipe(
    Effect.catchCause((cause) => (Cause.hasInterrupts(cause) ? Effect.failCause(cause) : Effect.succeed(undefined))),
  )
}

export function createSidechainRouter(input: {
  makeContext: (sessionID: string, parentMessageID: string) => MapperContext
}) {
  const chains = new Map<string, Chain>()
  // Task calls whose agent runs in the background (the SDK default). The CLI
  // announces these with `task_started` (carrying the spawning call's
  // tool_use_id) BEFORE the call's tool_result - which for a background agent
  // is only a launch ack, not completion. Settling the chain on that ack
  // would freeze the child transcript at birth and drop everything the agent
  // does; the real completion signal is the matching `task_notification`.
  const backgroundLaunches = new Set<string>()

  function mapThrough(chain: Chain, chainID: string, event: ClaudeEvent): SidechainAction[] {
    if (!chain.context) {
      chain.pending.push(event)
      return []
    }
    const mapped = mapEvent(event, chain.state, chain.context)
    chain.state = mapped.state
    if (mapped.writes.length === 0) return []
    return [{ kind: "writes", chainID, sessionID: chain.context.sessionID as string, writes: mapped.writes }]
  }

  function finalize(chain: Chain, chainID: string, reason = "subagent completed"): SidechainAction[] {
    if (chain.done || !chain.context) {
      chain.done = true
      return []
    }
    chain.done = true
    const finalized = finalizeAbandonedTurn(chain.state, chain.context, { reason })
    chain.state = finalized.state
    if (finalized.writes.length === 0) return []
    return [{ kind: "writes", chainID, sessionID: chain.context.sessionID as string, writes: finalized.writes }]
  }

  return {
    route(event: ClaudeEvent, mainToolParts: MapperState["toolParts"]): { handled: boolean; actions: SidechainAction[] } {
      const record = event as unknown as Record<string, unknown>
      const chainID = typeof record.parent_tool_use_id === "string" ? record.parent_tool_use_id : undefined

      if (chainID) {
        // `parent_tool_use_id` does not, by itself, mean "subagent". The CLI
        // also tags `tool_progress` heartbeat frames with it for any MAIN
        // conversation tool call that runs longer than ~30s (e.g. the swarm
        // delegate MCP tool) - there the field is the running call's own id.
        // Only conversation events can open or feed a chain; progress
        // telemetry is swallowed so it neither spawns a phantom "Claude
        // subagent" session nor buffers unboundedly in `chain.pending`.
        if (record.type !== "user" && record.type !== "assistant" && record.type !== "stream_event") {
          return { handled: true, actions: [] }
        }
        const existing = chains.get(chainID)
        if (existing) return { handled: true, actions: existing.done ? [] : mapThrough(existing, chainID, event) }
        const spawning = mainToolParts.get(chainID)
        const spawnInput = (spawning?.input ?? {}) as Record<string, unknown>
        const title =
          (typeof spawnInput.description === "string" && spawnInput.description) ||
          (typeof spawnInput.subagent_type === "string" && `${spawnInput.subagent_type} subagent`) ||
          "Claude subagent"
        const prompt = typeof spawnInput.prompt === "string" ? spawnInput.prompt : ""
        const chain: Chain = { state: initialState({}), pending: [event], done: false }
        chains.set(chainID, chain)
        return { handled: true, actions: [{ kind: "spawn", chainID, title, prompt }] }
      }

      // Task lifecycle telemetry marks background launches and settles them.
      // These are main-stream system events, so they stay unhandled - the main
      // mapper still sees them (it ignores what it does not know).
      if (record.type === "system") {
        if (record.subtype === "task_started" && typeof record.tool_use_id === "string") {
          backgroundLaunches.add(record.tool_use_id)
        }
        if (record.subtype === "task_notification" && typeof record.tool_use_id === "string") {
          backgroundLaunches.delete(record.tool_use_id)
          const chain = chains.get(record.tool_use_id)
          if (chain) {
            const reason =
              record.status === "failed"
                ? "subagent failed"
                : record.status === "stopped"
                  ? "subagent stopped"
                  : "subagent completed"
            return { handled: false, actions: finalize(chain, record.tool_use_id, reason) }
          }
        }
        return { handled: false, actions: [] }
      }

      // Main-stream event: a tool_result closing a chain's spawning call settles
      // that chain - unless the call launched a background agent, where the
      // tool_result is only the launch ack and the chain settles on its
      // task_notification instead. The event itself still belongs to the main
      // mapper.
      const actions: SidechainAction[] = []
      const message = record.message as Record<string, unknown> | undefined
      const content = Array.isArray(message?.content) ? (message!.content as Array<Record<string, unknown>>) : []
      if (record.type === "user") {
        for (const block of content) {
          if (block.type !== "tool_result" || typeof block.tool_use_id !== "string") continue
          if (backgroundLaunches.has(block.tool_use_id)) continue
          const chain = chains.get(block.tool_use_id)
          if (chain) actions.push(...finalize(chain, block.tool_use_id))
        }
      }
      return { handled: false, actions }
    },

    attachChild(chainID: string, sessionID: string, userMessageID: string): SidechainAction[] {
      const chain = chains.get(chainID)
      if (!chain || chain.context) return []
      chain.context = input.makeContext(sessionID, userMessageID)
      const pending = chain.pending
      chain.pending = []
      return pending.flatMap((event) => mapThrough(chain, chainID, event))
    },

    /**
     * A chain whose spawn was never recovered (attachChild is never going to be
     * called - the controller-side spawn failed) has nowhere to send its
     * pending events. Without this they would buffer unboundedly in
     * `chain.pending` for the rest of the turn.
     */
    abandonChain(chainID: string): void {
      const chain = chains.get(chainID)
      if (!chain) return
      chain.done = true
      chain.pending = []
    },

    finalizeAll(reason?: string): SidechainAction[] {
      return [...chains.entries()].flatMap(([chainID, chain]) => finalize(chain, chainID, reason))
    },
  }
}

export * as ClaudeSidechain from "./claude-sidechain"
