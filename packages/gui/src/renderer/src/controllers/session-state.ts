import type { Session } from "@opencode-ai/sdk/v2/client"
import { createSignal } from "solid-js"
import { readRecentModels } from "../lib/app-preferences"
import type { GuiPromptInfo } from "../lib/prompt-state"

export type QueuedSessionPrompt = {
  id: string
  sessionID: string
  prompt: GuiPromptInfo
  agent: string
  model: string
  variant: string
}

export function createSessionState() {
  const [prompt, setPrompt] = createSignal("")
  const [composerFocusToken, setComposerFocusToken] = createSignal(0)
  const [selectionSessionID, setSelectionSessionID] = createSignal("")
  const [selectedAgent, setSelectedAgent] = createSignal("")
  const [selectedModel, setSelectedModel] = createSignal("")
  const [selectedVariant, setSelectedVariant] = createSignal("")
  const [pendingPinnedRouteKey, setPendingPinnedRouteKey] = createSignal("")
  const [materializingSession, setMaterializingSession] = createSignal<Session>()
  const [materializingSessionID, setMaterializingSessionID] = createSignal("")
  const [recentModels, setRecentModels] = createSignal(readRecentModels())
  const [queuedPrompts, setQueuedPrompts] = createSignal<Record<string, QueuedSessionPrompt[]>>({})

  function queuePrompt(input: Omit<QueuedSessionPrompt, "id">) {
    const item = { ...input, id: crypto.randomUUID() }
    setQueuedPrompts((current) => ({
      ...current,
      [input.sessionID]: [...(current[input.sessionID] ?? []), item],
    }))
    return item
  }

  function removeQueuedPrompt(sessionID: string, id: string) {
    setQueuedPrompts((current) => {
      const next = (current[sessionID] ?? []).filter((item) => item.id !== id)
      if (next.length > 0) return { ...current, [sessionID]: next }
      const rest = { ...current }
      delete rest[sessionID]
      return rest
    })
  }

  function updateQueuedPrompt(sessionID: string, id: string, input: string) {
    setQueuedPrompts((current) => ({
      ...current,
      [sessionID]: (current[sessionID] ?? []).map((item) => {
        if (item.id !== id) return item
        return {
          ...item,
          prompt: {
            ...item.prompt,
            input,
            parts: item.prompt.mode === "shell"
              ? []
              : [
                  ...(input ? [{ type: "text" as const, text: input }] : []),
                  ...item.prompt.parts.filter((part) => part.type !== "text"),
                ],
          },
        }
      }),
    }))
  }

  return {
    prompt,
    setPrompt,
    composerFocusToken,
    requestComposerFocus: () => setComposerFocusToken((token) => token + 1),
    selectionSessionID,
    setSelectionSessionID,
    selectedAgent,
    setSelectedAgent,
    selectedModel,
    setSelectedModel,
    selectedVariant,
    setSelectedVariant,
    pendingPinnedRouteKey,
    setPendingPinnedRouteKey,
    materializingSession,
    setMaterializingSession,
    materializingSessionID,
    setMaterializingSessionID,
    recentModels,
    setRecentModels,
    queuedPrompts: (sessionID: string) => queuedPrompts()[sessionID] ?? [],
    queuePrompt,
    updateQueuedPrompt,
    removeQueuedPrompt,
  }
}
