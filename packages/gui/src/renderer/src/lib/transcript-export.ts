import type { Provider, Session } from "@opencode-ai/sdk/v2/client"
import type { MessageBundle } from "./store"
import { formatSessionTranscript, type GuiTranscriptOptions } from "./transcript"

export type GuiTranscriptExportOptions = GuiTranscriptOptions & {
  filename: string
  openWithoutSaving: boolean
}

export function defaultTranscriptExportOptions(input: {
  session: Session
  thinking: boolean
  toolDetails: boolean
  assistantMetadata: boolean
}): GuiTranscriptExportOptions {
  return {
    filename: `session-${input.session.id.slice(0, 8)}.md`,
    thinking: input.thinking,
    toolDetails: input.toolDetails,
    assistantMetadata: input.assistantMetadata,
    openWithoutSaving: false,
  }
}

export function prepareSessionTranscriptExport(input: {
  session: Session
  messages: MessageBundle[]
  providers: Provider[]
  options: GuiTranscriptExportOptions
}) {
  return {
    filename: normalizeTranscriptFilename(input.options.filename, input.session),
    markdown: formatSessionTranscript({
      session: input.session,
      messages: input.messages,
      providers: input.providers,
      options: input.options,
    }),
    openWithoutSaving: input.options.openWithoutSaving,
  }
}

export function normalizeTranscriptFilename(filename: string, session: Session) {
  const trimmed = filename.trim()
  const fallback = `session-${session.id.slice(0, 8)}.md`
  const safe = (trimmed || fallback)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^\.+$/, "")
    .trim()
  const value = safe || fallback
  return value.toLowerCase().endsWith(".md") ? value : `${value}.md`
}
