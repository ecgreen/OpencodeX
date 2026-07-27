import { batch, createMemo, onCleanup } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { updateClientSessionState } from "@opencode-ai/sdk/v2"
import type { useEvent } from "@tui/context/event"
import type { useRoute } from "@tui/context/route"
import type { useSDK } from "@tui/context/sdk"
import type { useSync } from "@tui/context/sync"
import { isRecord } from "@/util/record"
import { createLocalPersistence } from "./local-persistence"
import { markViewedSessionUiState } from "./session-viewed"

export function createLocalSession(input: {
  sync: ReturnType<typeof useSync>
  sdk: ReturnType<typeof useSDK>
  route: ReturnType<typeof useRoute>
  event: ReturnType<typeof useEvent>
}) {
  const [store, setStore] = createStore({
    ready: false,
    pinned: [] as string[],
    viewed: {} as Record<string, number>,
  })
  const save = createLocalPersistence({
    file: "session.json",
    ready: () => store.ready,
    setReady: () => setStore("ready", true),
    hydrate(value) {
      if (!isRecord(value)) return
      if (Array.isArray(value.pinned)) {
        const pinned = value.pinned.filter((item): item is string => typeof item === "string")
        setStore("pinned", pinned)
        void input.sync.session.ensure(pinned).catch(() => undefined)
      }
      if (isRecord(value.viewed)) {
        setStore(
          "viewed",
          Object.fromEntries(Object.entries(value.viewed).filter((item): item is [string, number] => typeof item[1] === "number")),
        )
      }
    },
    serialize: () => ({ pinned: store.pinned, viewed: store.viewed }),
  })
  const slots = createMemo(() => {
    const existing = new Set(input.sync.data.session.filter((session) => session.parentID === undefined).map((session) => session.id))
    return store.pinned.filter((id) => existing.has(id)).slice(0, 9)
  })

  const prune = (sessionID: string) => {
    batch(() => {
      if (store.pinned.includes(sessionID)) setStore("pinned", store.pinned.filter((id) => id !== sessionID))
      if (store.viewed[sessionID] !== undefined) setStore("viewed", sessionID, 0)
      save()
    })
  }

  onCleanup(input.event.on("session.deleted", (event) => prune(event.properties.info.id)))

  return {
    get ready() {
      return store.ready
    },
    pinned() {
      return store.pinned
    },
    slots,
    isPinned(sessionID: string) {
      return store.pinned.includes(sessionID)
    },
    lastViewed(sessionID: string) {
      return Math.max(store.viewed[sessionID] ?? 0, input.sync.data.session_ui_state[sessionID]?.seenAt ?? 0)
    },
    markViewed(sessionID: string, time = Date.now()) {
      const previous = store.viewed[sessionID]
      setStore("viewed", sessionID, time)
      const session = input.sync.session.get(sessionID)
      input.sync.set(
        "session_ui_state",
        sessionID,
        markViewedSessionUiState(sessionID, input.sync.data.session_ui_state[sessionID], time, session?.time.updated),
      )
      void updateClientSessionState(input.sdk.client, sessionID, { seenAt: time }).catch(() => {
        setStore(
          "viewed",
          produce((draft) => {
            if (previous === undefined) delete draft[sessionID]
            else draft[sessionID] = previous
          }),
        )
        void input.sync.session.refresh().catch(() => {})
        save()
      })
      save()
    },
    togglePin(sessionID: string) {
      batch(() => {
        setStore("pinned", store.pinned.includes(sessionID) ? store.pinned.filter((id) => id !== sessionID) : [...store.pinned, sessionID])
        save()
      })
    },
    quickSwitch(slot: number) {
      const target = slots()[slot - 1]
      if (!target) return
      if (input.route.data.type === "session" && input.route.data.sessionID === target) return
      input.route.navigate({ type: "session", sessionID: target })
    },
  }
}
