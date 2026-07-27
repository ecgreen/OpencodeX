import type { TextareaRenderable } from "@opentui/core"
import { produce, type SetStoreFunction } from "solid-js/store"
import type { PromptInfo } from "./history"
import type { PromptState } from "./types"

export function restorePromptExtmarks(input: {
  textarea: TextareaRenderable
  parts: PromptInfo["parts"]
  typeID: number
  fileStyleID: number
  agentStyleID: number
  pasteStyleID: number
  setStore: SetStoreFunction<PromptState>
}) {
  input.textarea.extmarks.clear()
  input.setStore("extmarkToPartIndex", new Map())
  input.parts.forEach((part, partIndex) => {
    const source = promptPartExtmarkSource(part, input.fileStyleID, input.agentStyleID, input.pasteStyleID)
    if (!source) return
    const extmarkID = input.textarea.extmarks.create({
      start: source.start,
      end: source.end,
      virtual: true,
      styleId: source.styleID,
      typeId: input.typeID,
    })
    input.setStore("extmarkToPartIndex", (map) => new Map(map).set(extmarkID, partIndex))
  })
}

export function syncPromptExtmarks(input: {
  textarea: TextareaRenderable
  typeID: number
  setStore: SetStoreFunction<PromptState>
}) {
  const extmarks = input.textarea.extmarks.getAllForTypeId(input.typeID)
  input.setStore(
    produce((draft) => {
      const map = new Map<number, number>()
      const parts: typeof draft.prompt.parts = []
      extmarks.forEach((extmark) => {
        const index = draft.extmarkToPartIndex.get(extmark.id)
        const part = index === undefined ? undefined : draft.prompt.parts[index]
        if (!part) return
        if (part.type === "agent" && part.source) {
          part.source.start = extmark.start
          part.source.end = extmark.end
        }
        if ((part.type === "file" || part.type === "text") && part.source?.text) {
          part.source.text.start = extmark.start
          part.source.text.end = extmark.end
        }
        map.set(extmark.id, parts.length)
        parts.push(part)
      })
      draft.extmarkToPartIndex = map
      draft.prompt.parts = parts
    }),
  )
}

export function expandPromptText(textarea: TextareaRenderable, state: PromptState, typeID: number) {
  return textarea.extmarks
    .getAllForTypeId(typeID)
    .toSorted((a, b) => b.start - a.start)
    .reduce((text, extmark) => {
      const index = state.extmarkToPartIndex.get(extmark.id)
      const part = index === undefined ? undefined : state.prompt.parts[index]
      if (part?.type !== "text" || !part.text) return text
      return text.slice(0, extmark.start) + part.text + text.slice(extmark.end)
    }, state.prompt.input)
}

function promptPartExtmarkSource(
  part: PromptInfo["parts"][number],
  fileStyleID: number,
  agentStyleID: number,
  pasteStyleID: number,
) {
  if (part.type === "file" && part.source?.text) {
    return { start: part.source.text.start, end: part.source.text.end, styleID: fileStyleID }
  }
  if (part.type === "agent" && part.source) {
    return { start: part.source.start, end: part.source.end, styleID: agentStyleID }
  }
  if (part.type === "text" && part.source?.text) {
    return { start: part.source.text.start, end: part.source.text.end, styleID: pasteStyleID }
  }
}
