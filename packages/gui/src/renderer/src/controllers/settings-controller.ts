import type { createAppearanceController } from "./appearance-controller"
import type { createAuthoritativeStateController } from "./authoritative-state-controller"
import type { createTranscriptPreferences } from "./transcript-preferences"

export function createSettingsController(input: {
  appearance: ReturnType<typeof createAppearanceController>
  authoritative: ReturnType<typeof createAuthoritativeStateController>
  transcript: ReturnType<typeof createTranscriptPreferences>
}) {
  return {
    themeMode: input.appearance.themeMode,
    setThemeMode: input.appearance.setThemeMode,
    lifecycle: () => input.authoritative.state()?.lifecycle,
    retry: input.authoritative.retry,
    concealCodeBlocks: input.transcript.concealTranscriptCodeBlocks,
    setConcealCodeBlocks: input.transcript.setConcealTranscriptCodeBlocks,
    showTimestamps: input.transcript.showTranscriptTimestamps,
    setShowTimestamps: input.transcript.setShowTranscriptTimestamps,
    showThinking: input.transcript.showTranscriptThinking,
    setShowThinking: input.transcript.setShowTranscriptThinking,
    showToolDetails: input.transcript.showTranscriptToolDetails,
    setShowToolDetails: input.transcript.setShowTranscriptToolDetails,
    showScrollbar: input.transcript.showTranscriptScrollbar,
    setShowScrollbar: input.transcript.setShowTranscriptScrollbar,
    showGenericToolOutput: input.transcript.showTranscriptGenericToolOutput,
    setShowGenericToolOutput: input.transcript.setShowTranscriptGenericToolOutput,
  }
}
