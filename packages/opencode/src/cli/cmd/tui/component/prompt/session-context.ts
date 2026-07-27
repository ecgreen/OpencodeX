import { createEffect, createMemo } from "solid-js"
import type { AssistantMessage, UserMessage } from "@opencode-ai/sdk/v2"
import { useArgs } from "@tui/context/args"
import { useLocal } from "@tui/context/local"
import { useSync } from "@tui/context/sync"
import { Locale } from "@/util/locale"
import { formatPromptCost } from "./helpers"

export function createPromptSessionContext(input: {
  sessionID: () => string | undefined
  useSessionContext: () => boolean | undefined
  swarmID: () => string | undefined
}) {
  const args = useArgs()
  const local = useLocal()
  const sync = useSync()
  const lastUserMessage = createMemo(() => {
    const sessionID = input.sessionID()
    if (!sessionID) return undefined
    return sync.data.message[sessionID]?.findLast((message): message is UserMessage => message.role === "user")
  })
  const startedSwarmSession = createMemo(() => input.swarmID() !== undefined && lastUserMessage() !== undefined)
  const agent = createMemo(() => {
    if (!input.useSessionContext()) return local.agent.current()
    const selected = local.agent.currentForSession(input.sessionID())
    if (selected) return selected
    const sessionID = input.sessionID()
    const name = lastUserMessage()?.agent ?? (sessionID ? sync.session.get(sessionID)?.agent : undefined)
    return local.agent.list().find((item) => item.name === name) ?? local.agent.current()
  })
  const effectiveAgent = createMemo(() => (input.swarmID() !== undefined ? local.agent.current() ?? agent() : agent()))
  const model = createMemo(() => {
    if (!input.useSessionContext()) return local.model.current()
    const message = lastUserMessage()?.model
    const sessionID = input.sessionID()
    const session = sessionID ? sync.session.get(sessionID)?.model : undefined
    const selectedAgent = local.agent.currentForSession(sessionID)
    return [
      message && { providerID: message.providerID, modelID: message.modelID },
      session && { providerID: session.providerID, modelID: session.id },
      selectedAgent?.model && { providerID: selectedAgent.model.providerID, modelID: selectedAgent.model.modelID },
    ].find(
      (value) => value && sync.data.provider.some((provider) => provider.id === value.providerID && provider.models[value.modelID]),
    ) ?? local.model.current()
  })
  const variant = createMemo(() => {
    if (!input.useSessionContext()) return local.model.variant.current()
    const selectedModel = model()
    const sessionID = input.sessionID()
    if (!selectedModel || !sessionID) return undefined
    const value = lastUserMessage()?.model?.variant ?? sync.session.get(sessionID)?.model?.variant
    return local.model.variant.currentForSession(sessionID, selectedModel, value)
  })
  const modelLabel = createMemo(() => {
    const selected = model()
    if (!selected) return { provider: "Connect a provider", model: "No provider selected" }
    const provider = sync.data.provider.find((item) => item.id === selected.providerID)
    return {
      provider: provider?.name ?? selected.providerID,
      model: provider?.models[selected.modelID]?.name ?? selected.modelID,
    }
  })
  const usage = createMemo(() => {
    const sessionID = input.sessionID()
    if (!sessionID) return
    const session = sync.session.get(sessionID)
    const last = (sync.data.message[sessionID] ?? []).findLast(
      (message): message is AssistantMessage => message.role === "assistant" && message.tokens.output > 0,
    )
    if (!last) return
    const tokens = last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
    if (tokens <= 0) return
    const selectedModel = sync.data.provider.find((item) => item.id === last.providerID)?.models[last.modelID]
    const percent = selectedModel?.limit.context ? `${Math.round((tokens / selectedModel.limit.context) * 100)}%` : undefined
    const cost = session?.cost ?? 0
    return {
      context: percent ? `${Locale.number(tokens)} (${percent})` : Locale.number(tokens),
      cost: cost > 0 ? formatPromptCost(cost) : undefined,
    }
  })

  let syncedSessionID: string | undefined
  createEffect(() => {
    const sessionID = input.sessionID()
    const message = lastUserMessage()
    if (sessionID === syncedSessionID || input.useSessionContext() || !sessionID || !message) return
    syncedSessionID = sessionID
    if (!local.agent.list().some((item) => item.name === message.agent) || !message.agent) return
    if (!args.agent) local.agent.set(message.agent)
    if (!message.model) return
    local.model.set(message.model, { persist: false, force: true })
    local.model.variant.set(message.model.variant, { persist: false })
  })

  return { lastUserMessage, startedSwarmSession, agent, effectiveAgent, model, variant, modelLabel, usage }
}
