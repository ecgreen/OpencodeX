import type { GlobalEvent } from "@opencode-ai/sdk/v2/client"

export function createGlobalEventFanout() {
  const listeners = new Set<(event: GlobalEvent) => void | Promise<void>>()

  function publish(event: GlobalEvent) {
    listeners.forEach((listener) => {
      void Promise.resolve().then(() => listener(event)).catch((cause) => console.error("Global event listener failed", cause))
    })
  }

  function subscribe(listener: (event: GlobalEvent) => void | Promise<void>) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  return { publish, subscribe }
}
