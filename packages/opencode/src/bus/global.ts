import { EventEmitter } from "events"
import { Identifier } from "@/id/id"

export type GlobalEvent = {
  directory?: string
  project?: string
  workspace?: string
  payload: any
}

class GlobalBusEmitter extends EventEmitter<{
  event: [GlobalEvent]
}> {
  override emit(eventName: "event", event: GlobalEvent): boolean {
    if (event.payload && typeof event.payload === "object" && !("id" in event.payload)) {
      event.payload.id = event.payload.syncEvent?.id ?? Identifier.create("evt", "ascending")
    }
    return super.emit(eventName, event)
  }
}

export const GlobalBus = new GlobalBusEmitter()

const subscribers = new Set<{ notify: (event: GlobalEvent) => void }>()
const publish = (event: GlobalEvent) => subscribers.forEach((subscriber) => subscriber.notify(event))

export function subscribeGlobalBus(subscriber: (event: GlobalEvent) => void) {
  if (subscribers.size === 0) GlobalBus.on("event", publish)
  const entry = { notify: subscriber }
  subscribers.add(entry)
  return () => {
    subscribers.delete(entry)
    if (subscribers.size === 0) GlobalBus.off("event", publish)
  }
}
