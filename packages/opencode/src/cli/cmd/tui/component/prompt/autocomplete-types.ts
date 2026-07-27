import type { BoxRenderable, TextareaRenderable } from "@opentui/core"
import type { SetStoreFunction } from "solid-js/store"
import type { PromptInfo } from "./history"

export type AutocompleteRef = {
  onInput: (value: string) => void
  visible: false | "@" | "/"
}

export type AutocompleteOption = {
  display: string
  value?: string
  aliases?: string[]
  disabled?: boolean
  description?: string
  isDirectory?: boolean
  onSelect?: () => void
  path?: string
}

export type AutocompleteState = {
  index: number
  selected: number
  visible: AutocompleteRef["visible"]
  input: "keyboard" | "mouse"
}

export type AutocompleteProps = {
  value: string
  sessionID?: string
  setPrompt: (input: (prompt: PromptInfo) => void) => void
  setExtmark: (partIndex: number, extmarkId: number) => void
  anchor: () => BoxRenderable
  input: () => TextareaRenderable
  ref: (ref: AutocompleteRef) => void
  fileStyleId: number
  agentStyleId: number
  promptPartTypeId: () => number
}

export type AutocompleteControllerInput = {
  props: AutocompleteProps
  state: AutocompleteState
  setStore: SetStoreFunction<AutocompleteState>
}

export type AutocompleteLineRange = { startLine: number; endLine?: number }

export function removeAutocompleteLineRange(input: string) {
  const hashIndex = input.lastIndexOf("#")
  return hashIndex === -1 ? input : input.substring(0, hashIndex)
}

export function extractAutocompleteLineRange(input: string) {
  const hashIndex = input.lastIndexOf("#")
  if (hashIndex === -1) return { baseQuery: input }
  const baseName = input.substring(0, hashIndex)
  const match = input.substring(hashIndex + 1).match(/^(\d+)(?:-(\d*))?$/)
  if (!match) return { baseQuery: baseName }
  const startLine = Number(match[1])
  return {
    lineRange: {
      baseName,
      startLine,
      endLine: match[2] && startLine < Number(match[2]) ? Number(match[2]) : undefined,
    },
    baseQuery: baseName,
  }
}
