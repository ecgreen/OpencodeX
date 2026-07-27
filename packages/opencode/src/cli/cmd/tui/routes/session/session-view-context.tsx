import type { Provider } from "@opencode-ai/sdk/v2"
import { createContext, useContext } from "solid-js"
import type { useSync } from "@tui/context/sync"
import type { useTuiConfig } from "@tui/context/tui-config"
import type { ThinkingMode } from "@tui/context/thinking"

export type SessionViewContextValue = {
  width: number
  sessionID: string
  conceal: () => boolean
  thinkingMode: () => ThinkingMode
  showThinking: () => boolean
  showTimestamps: () => boolean
  showDetails: () => boolean
  showGenericToolOutput: () => boolean
  diffWrapMode: () => "word" | "none"
  providers: () => ReadonlyMap<string, Provider>
  sync: ReturnType<typeof useSync>
  tui: ReturnType<typeof useTuiConfig>
}

const context = createContext<SessionViewContextValue>()

export const SessionViewProvider = context.Provider

export function useSessionView() {
  const value = useContext(context)
  if (!value) throw new Error("useSessionView must be used within a SessionViewProvider")
  return value
}
