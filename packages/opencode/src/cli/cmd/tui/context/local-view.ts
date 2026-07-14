import { batch } from "solid-js"
import { createStore } from "solid-js/store"
import { isRecord } from "@/util/record"
import { createLocalPersistence } from "./local-persistence"

export function createLocalView() {
  const [store, setStore] = createStore({ ready: false, pinned: [] as string[] })
  const save = createLocalPersistence({
    file: "view.json",
    ready: () => store.ready,
    setReady: () => setStore("ready", true),
    hydrate(value) {
      if (!isRecord(value) || !Array.isArray(value.pinned)) return
      setStore("pinned", value.pinned.filter((item): item is string => typeof item === "string"))
    },
    serialize: () => ({ pinned: store.pinned }),
  })

  return {
    get ready() {
      return store.ready
    },
    pinned() {
      return store.pinned
    },
    isPinned(viewID: string) {
      return store.pinned.includes(viewID)
    },
    togglePin(viewID: string) {
      batch(() => {
        setStore("pinned", store.pinned.includes(viewID) ? store.pinned.filter((id) => id !== viewID) : [...store.pinned, viewID])
        save()
      })
    },
  }
}
