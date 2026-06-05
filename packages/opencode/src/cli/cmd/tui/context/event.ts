import type { Event } from "@opencode-ai/sdk/v2"
import { useProject } from "./project"
import { useSDK } from "./sdk"

type EventMetadata = {
  workspace: string | undefined
}

export function useEvent() {
  const project = useProject()
  const sdk = useSDK()

  function subscribe(handler: (event: Event, metadata: EventMetadata) => void) {
    return sdk.event.on("event", (event) => {
      if (event.directory === "global" || event.project === project.project()) {
        const payload = normalizeGlobalPayload(event.payload)
        if (payload) handler(payload, { workspace: event.workspace })
      }
    })
  }

  function on<T extends Event["type"]>(
    type: T,
    handler: (event: Extract<Event, { type: T }>, metadata: EventMetadata) => void,
  ) {
    return subscribe((event: Event, metadata: EventMetadata) => {
      if (event.type !== type) return
      handler(event as Extract<Event, { type: T }>, metadata)
    })
  }

  return {
    subscribe,
    on,
  }
}

function normalizeGlobalPayload(payload: unknown): Event | undefined {
  if (!isRecord(payload)) return
  if (payload.type === "sync") {
    const name = typeof payload.name === "string" ? payload.name.replace(/\.\d+$/, "") : undefined
    if (!name) return
    return { id: payload.id, type: name, properties: payload.data } as Event
  }
  return payload as Event
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
