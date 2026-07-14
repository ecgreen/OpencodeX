import { createSignal } from "solid-js"
import { readBoolPreference, writeBoolPreference } from "../lib/app-preferences"

const preferences = {
  concealCode: { key: "opencodex.gui.transcript.concealCode", fallback: true },
  timestamps: { key: "opencodex.gui.transcript.timestamps", fallback: false },
  thinking: { key: "opencodex.gui.transcript.thinking", fallback: true },
  toolDetails: { key: "opencodex.gui.transcript.toolDetails", fallback: true },
  scrollbar: { key: "opencodex.gui.transcript.scrollbar", fallback: true },
  genericToolOutput: { key: "opencodex.gui.transcript.genericToolOutput", fallback: true },
} as const

export function createTranscriptPreferences(notify: (message: string) => void) {
  const [concealTranscriptCodeBlocks, setConcealTranscriptCodeBlocks] = createSignal(
    readBoolPreference(preferences.concealCode.key, preferences.concealCode.fallback),
  )
  const [showTranscriptTimestamps, setShowTranscriptTimestamps] = createSignal(
    readBoolPreference(preferences.timestamps.key, preferences.timestamps.fallback),
  )
  const [showTranscriptThinking, setShowTranscriptThinking] = createSignal(
    readBoolPreference(preferences.thinking.key, preferences.thinking.fallback),
  )
  const [showTranscriptToolDetails, setShowTranscriptToolDetails] = createSignal(
    readBoolPreference(preferences.toolDetails.key, preferences.toolDetails.fallback),
  )
  const [showTranscriptScrollbar, setShowTranscriptScrollbar] = createSignal(
    readBoolPreference(preferences.scrollbar.key, preferences.scrollbar.fallback),
  )
  const [showTranscriptGenericToolOutput, setShowTranscriptGenericToolOutput] = createSignal(
    readBoolPreference(preferences.genericToolOutput.key, preferences.genericToolOutput.fallback),
  )

  function toggle(
    read: () => boolean,
    write: (value: boolean) => void,
    preference: (typeof preferences)[keyof typeof preferences],
    enabled: string,
    disabled: string,
  ) {
    const next = !read()
    write(next)
    writeBoolPreference(preference.key, next)
    notify(next ? enabled : disabled)
  }

  return {
    concealTranscriptCodeBlocks,
    showTranscriptTimestamps,
    showTranscriptThinking,
    showTranscriptToolDetails,
    showTranscriptScrollbar,
    showTranscriptGenericToolOutput,
    handleToggleCodeConcealSlash: () =>
      toggle(
        concealTranscriptCodeBlocks,
        setConcealTranscriptCodeBlocks,
        preferences.concealCode,
        "Code blocks concealed.",
        "Code blocks expanded.",
      ),
    handleToggleTimestampsSlash: () =>
      toggle(
        showTranscriptTimestamps,
        setShowTranscriptTimestamps,
        preferences.timestamps,
        "Message timestamps shown.",
        "Message timestamps hidden.",
      ),
    handleToggleThinkingSlash: () =>
      toggle(
        showTranscriptThinking,
        setShowTranscriptThinking,
        preferences.thinking,
        "Thinking content shown.",
        "Thinking content hidden.",
      ),
    handleToggleToolDetailsSlash: () =>
      toggle(
        showTranscriptToolDetails,
        setShowTranscriptToolDetails,
        preferences.toolDetails,
        "Tool details shown.",
        "Tool details hidden.",
      ),
    handleToggleScrollbarSlash: () =>
      toggle(
        showTranscriptScrollbar,
        setShowTranscriptScrollbar,
        preferences.scrollbar,
        "Session scrollbar shown.",
        "Session scrollbar hidden.",
      ),
    handleToggleGenericToolOutputSlash: () =>
      toggle(
        showTranscriptGenericToolOutput,
        setShowTranscriptGenericToolOutput,
        preferences.genericToolOutput,
        "Generic tool output shown.",
        "Generic tool output hidden.",
      ),
  }
}
