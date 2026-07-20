import type { Event, GlobalEvent } from "@opencode-ai/sdk/v2/client"

export function createGlobalEventBatcher(input: {
  delay: number
  apply: (events: readonly Event[]) => boolean[]
  fallback: (event: GlobalEvent) => void
}) {
  const pending: Array<{ source: GlobalEvent; payload: Event }> = []
  let timer: ReturnType<typeof setTimeout> | undefined
  let immediate = false

  function flush() {
    timer = undefined
    const events = pending.splice(0)
    if (events.length === 0) return
    const handled = input.apply(events.map((event) => event.payload))
    events.forEach((event, index) => {
      if (!handled[index]) input.fallback(event.source)
    })
  }

  return {
    push(source: GlobalEvent, payload: Event) {
      if (immediate) {
        if (!input.apply([payload])[0]) input.fallback(source)
        return
      }
      pending.push({ source, payload })
      if (timer === undefined) timer = setTimeout(flush, input.delay)
    },
    setImmediate(value: boolean) {
      if (immediate === value) return
      immediate = value
      if (immediate) flush()
    },
    clear() {
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
      pending.length = 0
    },
  }
}
