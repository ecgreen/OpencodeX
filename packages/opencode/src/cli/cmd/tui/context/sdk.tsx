import { createOpencodeClient } from "@opencode-ai/sdk/v2"
import type { GlobalEvent } from "@opencode-ai/sdk/v2"
import { CLIENT_SESSION_SYNC_INTERVAL_MS } from "@opencode-ai/sdk/v2"
import { createSimpleContext } from "./helper"
import { createGlobalEmitter } from "@solid-primitives/event-bus"
import { batch, onCleanup, onMount } from "solid-js"

const SEEN_EVENT_ID_LIMIT = 2_000

type SyncHistoryCursor = Record<string, number>
type SyncHistoryEvent = {
  id: string
  aggregate_id: string
  seq: number
  type: string
  data: Record<string, unknown>
}

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

    async function request<T>(path: string, init?: RequestInit) {
      const headers = new Headers(props.headers)
      if (init?.headers) {
        new Headers(init.headers).forEach((value, key) => headers.set(key, value))
      }
      if (init?.body && !headers.has("content-type")) headers.set("content-type", "application/json")
      const response = await (props.fetch ?? fetch)(new URL(path, props.url), {
        ...init,
        headers,
        signal: abort.signal,
      })
      if (!response.ok) throw new Error(await response.text())
      return (await response.json()) as T
    }

    const emitter = createGlobalEmitter<{
      event: GlobalEvent
    }>()

    let queue: GlobalEvent[] = []
    let timer: Timer | undefined
    let historyTimer: Timer | undefined
    let last = 0
    const retryDelay = 1000
    const maxRetryDelay = 30000
    let syncHistoryCursor: SyncHistoryCursor = {}
    let syncHistoryPrimed = false
    let syncHistoryRunning = false
    const seenEventIDs = new Set<string>()
    const seenEventIDOrder: string[] = []

    const flush = () => {
      if (queue.length === 0) return
      const events = queue
      queue = []
      timer = undefined
      last = Date.now()
      // Batch all event emissions so all store updates result in a single render
      batch(() => {
        for (const event of events) {
          emitter.emit("event", event)
        }
      })
    }

    const handleEvent = (event: GlobalEvent) => {
      if (!rememberGlobalEvent(event)) return
      queue.push(event)
      const elapsed = Date.now() - last

      if (timer) return
      // If we just flushed recently (within 16ms), batch this with future events
      // Otherwise, process immediately to avoid latency
      if (elapsed < 16) {
        timer = setTimeout(flush, 16)
        return
      }
      flush()
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

    function syncHistoryEventToGlobalEvent(event: SyncHistoryEvent): GlobalEvent {
      return {
        directory: "global",
        payload: { id: event.id, type: "sync", name: event.type, seq: event.seq, aggregateID: event.aggregate_id, data: event.data },
      } as GlobalEvent
    }

    async function syncPersistedHistory() {
      if (syncHistoryRunning) return
      syncHistoryRunning = true
      try {
        let events: SyncHistoryEvent[]
        try {
          events = await sdk.sync.history.list({ directory: props.directory, body: syncHistoryCursor }).then((x) => x.data ?? [])
        } catch {
          return
        }
        if (events.length === 0) {
          syncHistoryPrimed = true
          return
        }

        const nextCursor = { ...syncHistoryCursor }
        for (const event of events) nextCursor[event.aggregate_id] = Math.max(nextCursor[event.aggregate_id] ?? 0, event.seq)
        syncHistoryCursor = nextCursor

        if (!syncHistoryPrimed) {
          const initialStatusIDs = latestSessionStatusEventIDs(events)
          for (const event of events) {
            if (initialStatusIDs.has(event.id)) handleEvent(syncHistoryEventToGlobalEvent(event))
            else rememberEventID(event.id)
          }
          syncHistoryPrimed = true
          return
        }

        for (const event of events) handleEvent(syncHistoryEventToGlobalEvent(event))
      } finally {
        syncHistoryRunning = false
      }
    }

    function startHistoryPolling() {
      if (historyTimer) return
      const tick = () => {
        void syncPersistedHistory().finally(() => {
          if (!abort.signal.aborted) historyTimer = setTimeout(tick, CLIENT_SESSION_SYNC_INTERVAL_MS)
        })
      }
      historyTimer = setTimeout(tick, CLIENT_SESSION_SYNC_INTERVAL_MS)
    }

    function latestSessionStatusEventIDs(events: SyncHistoryEvent[]) {
      const latest = new Map<string, string>()
      for (const event of events) {
        if (syncHistoryEventKind(event) === "session.status") latest.set(event.aggregate_id, event.id)
      }
      return new Set(latest.values())
    }

    function syncHistoryEventKind(event: SyncHistoryEvent) {
      return event.type.replace(/\.\d+$/, "")
    }

    function startSSE() {
      sse?.abort()
      const ctrl = new AbortController()
      sse = ctrl
      ;(async () => {
        let attempt = 0
        while (true) {
          if (abort.signal.aborted || ctrl.signal.aborted) break

          const events = await sdk.global.event({
            signal: ctrl.signal,
            sseMaxRetryAttempts: 0,
          })

          // Start syncing after listening, then poll persisted sync history as
          // a safety net for missed or cross-process events.
          await sdk.sync.start().catch(() => {})
          startHistoryPolling()

          for await (const event of events.stream) {
            if (ctrl.signal.aborted) break
            handleEvent(event)
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

        // Start syncing after listening, then poll persisted sync history as a
        // safety net for missed or cross-process events.
        await sdk.sync.start().catch(() => {})
        startHistoryPolling()
      } else {
        startSSE()
      }
    })

    onCleanup(() => {
      abort.abort()
      sse?.abort()
      if (timer) clearTimeout(timer)
      if (historyTimer) clearTimeout(historyTimer)
    })

    return {
      get client() {
        return sdk
      },
      directory: props.directory,
      event: emitter,
      fetch: props.fetch ?? fetch,
      request,
      url: props.url,
    }
  },
})
