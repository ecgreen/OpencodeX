import type { Event } from "@opencode-ai/sdk/v2"
import { useProject } from "./project"
import { useSDK } from "./sdk"

type EventMetadata = {
  directory: string
  workspace: string | undefined
}

type EventItem = {
  event: Event
  metadata: EventMetadata
}

export function useEvent() {
  const project = useProject()
  const sdk = useSDK()

  function subscribeAll(handler: (event: Event, metadata: EventMetadata) => void) {
    return sdk.event.on("event", (event) => {
      const payload = normalizeGlobalPayload(event.payload)
      if (payload) handler(payload, { directory: event.directory, workspace: event.workspace })
    })
  }

  function subscribe(handler: (event: Event, metadata: EventMetadata) => void) {
    return sdk.event.on("event", (event) => {
      if (event.directory !== "global" && event.directory !== project.instance.directory()) return
      const payload = normalizeGlobalPayload(event.payload)
      if (payload) handler(payload, { directory: event.directory, workspace: event.workspace })
    })
  }

  function subscribeBatchAll(handler: (events: EventItem[]) => void) {
    return sdk.event.on("batch", (events) => {
      handler(
        events.flatMap((event) => {
          const payload = normalizeGlobalPayload(event.payload)
          return payload
            ? [{ event: payload, metadata: { directory: event.directory, workspace: event.workspace } }]
            : []
        }),
      )
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
    subscribeAll,
    subscribeBatchAll,
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
