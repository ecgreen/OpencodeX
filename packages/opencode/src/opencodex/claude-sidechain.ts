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
  sessionID?: string
  /** Events seen before the child session exists; replayed on attachChild. */
  pending: ClaudeEvent[]
  done: boolean
}

export type SidechainRouter = ReturnType<typeof createSidechainRouter>

export function createSidechainRouter(input: {
  makeContext: (sessionID: string, parentMessageID: string) => MapperContext
}) {
  const chains = new Map<string, Chain>()

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

  function finalize(chain: Chain, chainID: string): SidechainAction[] {
    if (chain.done || !chain.context) {
      chain.done = true
      return []
    }
    chain.done = true
    const finalized = finalizeAbandonedTurn(chain.state, chain.context, { reason: "subagent completed" })
    chain.state = finalized.state
    if (finalized.writes.length === 0) return []
    return [{ kind: "writes", chainID, sessionID: chain.context.sessionID as string, writes: finalized.writes }]
  }

  return {
    route(event: ClaudeEvent, mainToolParts: MapperState["toolParts"]): { handled: boolean; actions: SidechainAction[] } {
      const record = event as unknown as Record<string, unknown>
      const chainID = typeof record.parent_tool_use_id === "string" ? record.parent_tool_use_id : undefined

      if (chainID) {
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

      // Main-stream event: a tool_result closing a chain's spawning call settles
      // that chain. The event itself still belongs to the main mapper.
      const actions: SidechainAction[] = []
      const message = record.message as Record<string, unknown> | undefined
      const content = Array.isArray(message?.content) ? (message!.content as Array<Record<string, unknown>>) : []
      if (record.type === "user") {
        for (const block of content) {
          if (block.type !== "tool_result" || typeof block.tool_use_id !== "string") continue
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
      chain.sessionID = sessionID
      const pending = chain.pending
      chain.pending = []
      return pending.flatMap((event) => mapThrough(chain, chainID, event))
    },

    finalizeAll(): SidechainAction[] {
      return [...chains.entries()].flatMap(([chainID, chain]) => finalize(chain, chainID))
    },
  }
}

export * as ClaudeSidechain from "./claude-sidechain"
