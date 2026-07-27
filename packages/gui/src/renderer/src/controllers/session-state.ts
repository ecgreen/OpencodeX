import type { Session } from "@opencode-ai/sdk/v2/client"
import { createSignal } from "solid-js"
import { readRecentModels } from "../lib/app-preferences"

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
  }
}
