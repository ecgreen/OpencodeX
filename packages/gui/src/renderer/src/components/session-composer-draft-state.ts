import { createSignal } from "solid-js"
import type { PromptPart } from "../lib/store"
import { EMPTY_VIEW_PANE_RUNTIME_STATE } from "../lib/view-pane-state"
import type { SessionPageProps } from "./session-page-types"

export function createSessionComposerDraftState(
  props: Pick<SessionPageProps, "prompt" | "composerState" | "updateComposerState">,
) {
  const [localDraftPrompt, setLocalDraftPrompt] = createSignal(props.prompt)
  const [localDraftParts, setLocalDraftParts] = createSignal<PromptPart[]>([])
  const [localHistoryIndex, setLocalHistoryIndex] = createSignal(-1)
  const [localHistoryDraft, setLocalHistoryDraft] = createSignal("")
  const composerState = () => props.composerState ?? EMPTY_VIEW_PANE_RUNTIME_STATE
  const draftPrompt = () => (props.composerState ? composerState().draft.input : localDraftPrompt())
  const draftParts = () => (props.composerState ? composerState().draft.parts : localDraftParts())
  const historyIndex = () => (props.composerState ? composerState().historyIndex : localHistoryIndex())
  const historyDraft = () => (props.composerState ? composerState().historyDraft : localHistoryDraft())
  const setDraftPrompt = (value: string | ((current: string) => string)) => {
    if (!props.updateComposerState) return setLocalDraftPrompt(value)
    props.updateComposerState((state) => {
      const next = typeof value === "function" ? value(state.draft.input) : value
      return { ...state, draft: { ...state.draft, input: next } }
    })
  }
  const setDraftParts = (value: PromptPart[] | ((current: PromptPart[]) => PromptPart[])) => {
    if (!props.updateComposerState) return setLocalDraftParts(value)
    props.updateComposerState((state) => {
      const next = typeof value === "function" ? value(state.draft.parts) : value
      return { ...state, draft: { ...state.draft, parts: next } }
    })
  }
  const setHistoryIndex = (value: number | ((current: number) => number)) => {
    if (!props.updateComposerState) return setLocalHistoryIndex(value)
    props.updateComposerState((state) => ({
      ...state,
      historyIndex: typeof value === "function" ? value(state.historyIndex) : value,
    }))
  }
  const setHistoryDraft = (value: string | ((current: string) => string)) => {
    if (!props.updateComposerState) return setLocalHistoryDraft(value)
    props.updateComposerState((state) => ({
      ...state,
      historyDraft: typeof value === "function" ? value(state.historyDraft) : value,
    }))
  }
  return {
    draftPrompt,
    draftParts,
    historyIndex,
    historyDraft,
    setDraftPrompt,
    setDraftParts,
    setHistoryIndex,
    setHistoryDraft,
  }
}
