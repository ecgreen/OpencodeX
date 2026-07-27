import { createOpencodeClient } from "@opencode-ai/sdk/v2"
import type { GlobalEvent } from "@opencode-ai/sdk/v2"
import { createSimpleContext } from "./helper"
import { createGlobalEmitter } from "@solid-primitives/event-bus"
import { batch, createSignal, onCleanup, onMount } from "solid-js"

const SEEN_EVENT_ID_LIMIT = 2_000

export type EventSource = {
  subscribe: (handler: (event: GlobalEvent) => void) => Promise<() => void>
}

export const { use: useSDK, provider: SDKProvider } = createSimpleContext({
  name: "SDK",
  init: (props: {
    url: string
    directory?: string
    fetch?: typeof fetch
    headers?: RequestInit["headers"]
    events?: EventSource
  }) => {
    const abort = new AbortController()
    let sse: AbortController | undefined
    const [eventConnectionGeneration, setEventConnectionGeneration] = createSignal(0)

    function createSDK() {
      return createOpencodeClient({
        baseUrl: props.url,
        signal: abort.signal,
        directory: props.directory,
        fetch: props.fetch,
        headers: props.headers,
      })
    }

    let sdk = createSDK()

    const routedFetch = Object.assign(
      async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        const headers = new Headers(props.headers)
        if (input instanceof Request) input.headers.forEach((value, key) => headers.set(key, value))
        if (init?.headers) {
          new Headers(init.headers).forEach((value, key) => headers.set(key, value))
        }
        if (props.directory && !headers.has("x-opencode-directory"))
          headers.set("x-opencode-directory", props.directory)
        return (props.fetch ?? fetch)(input, { ...init, headers, signal: init?.signal ?? abort.signal })
      },
      { preconnect: (props.fetch ?? fetch).preconnect },
    )

    async function request<T>(path: string, init?: RequestInit) {
      const headers = new Headers(init?.headers)
      if (init?.body && !headers.has("content-type")) headers.set("content-type", "application/json")
      const response = await routedFetch(new URL(path, props.url), {
        ...init,
        headers,
      })
      if (!response.ok) throw new Error(await response.text())
      return (await response.json()) as T
    }

    const emitter = createGlobalEmitter<{
      event: GlobalEvent
      batch: GlobalEvent[]
    }>()

    let queue: GlobalEvent[] = []
    let timer: Timer | undefined
    const retryDelay = 1000
    const maxRetryDelay = 30000
    const seenEventIDs = new Set<string>()
    const seenEventIDOrder: string[] = []

    const flush = () => {
      if (queue.length === 0) return
      const events = queue
      queue = []
      timer = undefined
      // Batch all event emissions so all store updates result in a single render
      batch(() => {
        emitter.emit("batch", events)
        for (const event of events) {
          emitter.emit("event", event)
        }
      })
    }

    const handleEvent = (event: GlobalEvent) => {
      if (!rememberGlobalEvent(event)) return
      queue.push(event)
      if (timer) return
      timer = setTimeout(flush, 16)
    }

    function rememberGlobalEvent(event: GlobalEvent) {
      const id = globalEventID(event)
      return id ? rememberEventID(id) : true
    }

    function rememberEventID(id: string) {
      if (seenEventIDs.has(id)) return false
      seenEventIDs.add(id)
      seenEventIDOrder.push(id)
      while (seenEventIDOrder.length > SEEN_EVENT_ID_LIMIT) {
        const stale = seenEventIDOrder.shift()
        if (stale) seenEventIDs.delete(stale)
      }
      return true
    }

    function globalEventID(event: GlobalEvent) {
      const id = (event.payload as { id?: string }).id
      return typeof id === "string" ? id : undefined
    }

    function startSSE() {
      sse?.abort()
      const ctrl = new AbortController()
      sse = ctrl
      ;(async () => {
        let attempt = 0
        while (true) {
          if (abort.signal.aborted || ctrl.signal.aborted) break
          try {
            const events = await sdk.global.event({
              signal: ctrl.signal,
              sseMaxRetryAttempts: 0,
            })
            const iterator = events.stream[Symbol.asyncIterator]()
            const first = await iterator.next()
            if (first.done) throw new Error("Global event stream ended before connecting")

            // Pulling the first frame opens the lazy SSE request before projectors
            // can emit events. The iterator buffers later frames during startup.
            await sdk.sync.start()
            attempt = 0
            setEventConnectionGeneration((generation) => generation + 1)
            handleEvent(first.value)

            for await (const event of { [Symbol.asyncIterator]: () => iterator }) {
              if (ctrl.signal.aborted) break
              handleEvent(event)
            }
          } catch {
            if (abort.signal.aborted || ctrl.signal.aborted) break
          }

          if (timer) clearTimeout(timer)
          if (queue.length > 0) flush()
          attempt += 1
          if (abort.signal.aborted || ctrl.signal.aborted) break

          // Exponential backoff
          const backoff = Math.min(retryDelay * 2 ** (attempt - 1), maxRetryDelay)
          await new Promise((resolve) => setTimeout(resolve, backoff))
        }
      })().catch(() => {})
    }

    onMount(async () => {
      if (props.events) {
        const unsub = await props.events.subscribe(handleEvent)
        onCleanup(unsub)

        // Start projectors after listening. The state controller owns replay.
        await sdk.sync.start()
        setEventConnectionGeneration((generation) => generation + 1)
      } else {
        startSSE()
      }
    })

    onCleanup(() => {
      abort.abort()
      sse?.abort()
      if (timer) clearTimeout(timer)
    })

    return {
      get client() {
        return sdk
      },
      directory: props.directory,
      event: emitter,
      eventConnectionGeneration,
      fetch: routedFetch,
      request,
      url: props.url,
    }
  },
})
