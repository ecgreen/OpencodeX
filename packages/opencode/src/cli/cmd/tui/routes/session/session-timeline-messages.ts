import type { Message, Part } from "@opencode-ai/sdk/v2"
import { createMemo, createResource } from "solid-js"
import { useSync } from "@tui/context/sync"

export type SessionTimelineBundle = { info: Message; parts: Part[] }

/**
 * Every message in a session, for the dialogs that search or fork across the
 * whole history.
 *
 * The rendered transcript is a bounded window, so the store alone would hide
 * older prompts from these lists. This reads the history straight from the
 * server - which never adds it to resident state - and falls back to the
 * window until the read lands.
 */
export function useSessionTimelineMessages(sessionID: () => string) {
  const sync = useSync()
  const [full] = createResource(sessionID, (id) => sync.session.transcriptMessages(id))
  const windowed = createMemo(
    (): SessionTimelineBundle[] =>
      (sync.data.message[sessionID()] ?? []).map((info) => ({ info, parts: sync.data.part[info.id] ?? [] })),
  )
  return createMemo((): SessionTimelineBundle[] => {
    if (full.loading || full.error) return windowed()
    return full() ?? windowed()
  })
}
