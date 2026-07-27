import { emptyPrompt, type GuiPromptInfo } from "./prompt-state"

export type ViewPaneRuntimeState = {
  draft: GuiPromptInfo
  historyDraft: string
  historyIndex: number
  selectedAgent?: string
  selectedModel?: string
  selectedVariant?: string
  loading: boolean
  loadedTime?: number
}

export const EMPTY_VIEW_PANE_RUNTIME_STATE: ViewPaneRuntimeState = {
  draft: emptyPrompt(),
  historyDraft: "",
  historyIndex: -1,
  loading: false,
}

export function setRecordEntry<T>(current: Record<string, T>, key: string, next: T | undefined) {
  if (next === undefined) {
    if (!(key in current)) return current
    return Object.fromEntries(Object.entries(current).filter(([item]) => item !== key)) as Record<string, T>
  }
  if (current[key] === next) return current
  return { ...current, [key]: next }
}

export function updateViewPaneRuntimeState(
  current: Record<string, ViewPaneRuntimeState>,
  key: string,
  update: (state: ViewPaneRuntimeState) => ViewPaneRuntimeState,
) {
  return setRecordEntry(current, key, update(current[key] ?? EMPTY_VIEW_PANE_RUNTIME_STATE))
}

export function pruneRecordKeys<T>(current: Record<string, T>, keep: ReadonlySet<string>) {
  const entries = Object.entries(current).filter(([key]) => keep.has(key))
  if (entries.length === Object.keys(current).length) return current
  return Object.fromEntries(entries) as Record<string, T>
}
