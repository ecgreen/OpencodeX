import { createSignal } from "solid-js"
import { readBoolPreference, writeBoolPreference } from "./app-preferences"

const PREFERENCE_KEY = "opencodex.gui.transcript.splitDiff"

export type DiffStyle = "unified" | "split"

const [split, setSplit] = createSignal(readBoolPreference(PREFERENCE_KEY, false))

/**
 * Diff layout is a reading preference, not a property of one patch, so every
 * transcript diff shares it and it survives a reload.
 */
export function transcriptDiffStyle(): DiffStyle {
  return split() ? "split" : "unified"
}

export function toggleTranscriptDiffStyle() {
  const next = !split()
  setSplit(next)
  writeBoolPreference(PREFERENCE_KEY, next)
  return next
}
