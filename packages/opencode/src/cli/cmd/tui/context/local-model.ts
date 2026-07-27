import { batch, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { uniqueBy } from "remeda"
import type { useArgs } from "./args"
import type { useSDK } from "./sdk"
import type { useSync } from "./sync"
import type { useToast } from "../ui/toast"
import { isRecord } from "@/util/record"
import type { LocalAgent } from "./local-agent"
import { createLocalPersistence } from "./local-persistence"
import {
  isModelSelection,
  modelSelectionKey,
  parseModel,
  sameModel,
  sessionModelPayload,
  type ModelSelection,
} from "./local-types"

export function createLocalModel(input: {
  sync: ReturnType<typeof useSync>
  sdk: ReturnType<typeof useSDK>
  toast: ReturnType<typeof useToast>
  args: ReturnType<typeof useArgs>
  agent: LocalAgent
  activeSessionID: () => string | undefined
  activeSessionSwarmID: () => string | undefined
  activeSessionHasUserMessage: () => boolean
  isModelValid: (model: ModelSelection) => boolean
}) {
  const [store, setStore] = createStore<{
    ready: boolean
    model: Record<string, ModelSelection>
    session: Record<string, ModelSelection>
    recent: ModelSelection[]
    favorite: ModelSelection[]
    variant: Record<string, string | undefined>
    sessionVariant: Record<string, string | undefined>
  }>({
    ready: false,
    model: {},
    session: {},
    recent: [],
    favorite: [],
    variant: {},
    sessionVariant: {},
  })
  const save = createLocalPersistence({
    file: "model.json",
    ready: () => store.ready,
    setReady: () => setStore("ready", true),
    hydrate(value) {
      if (!isRecord(value)) return
      if (Array.isArray(value.recent)) setStore("recent", value.recent.filter(isModelSelection))
      if (Array.isArray(value.favorite)) setStore("favorite", value.favorite.filter(isModelSelection))
      if (isRecord(value.variant)) setStore("variant", readVariantMap(value.variant))
      if (isRecord(value.sessionVariant)) setStore("sessionVariant", readVariantMap(value.sessionVariant))
      if (isRecord(value.session)) {
        setStore(
          "session",
          Object.fromEntries(Object.entries(value.session).filter((item): item is [string, ModelSelection] => isModelSelection(item[1]))),
        )
      }
    },
    serialize: () => ({
      recent: store.recent,
      favorite: store.favorite,
      variant: store.variant,
      session: store.session,
      sessionVariant: store.sessionVariant,
    }),
  })

  const persistSessionModelForSession = (sessionID: string, model: ModelSelection, variant: string | undefined) => {
    void input.sdk
      .request(`/session/${sessionID}`, {
        method: "PATCH",
        body: JSON.stringify({ model: sessionModelPayload(model, variant) }),
      })
      .catch((error: unknown) => {
        input.toast.show({
          message: `Failed to save model for session: ${error instanceof Error ? error.message : String(error)}`,
          variant: "warning",
          duration: 3000,
        })
      })
  }

  const persistSessionModel = (model: ModelSelection, variant: string | undefined) => {
    const sessionID = input.activeSessionID()
    if (sessionID) persistSessionModelForSession(sessionID, model, variant)
  }

  const fallbackModel = createMemo(() => {
    for (const candidate of [input.args.model, input.sync.data.config.model]) {
      if (!candidate) continue
      const parsed = parseModel(candidate)
      if (input.isModelValid(parsed)) return parsed
    }
    const recent = store.recent.find(input.isModelValid)
    if (recent) return recent
    const provider = input.sync.data.provider[0]
    if (!provider) return undefined
    const modelID = input.sync.data.provider_default[provider.id] ?? Object.values(provider.models)[0]?.id
    if (!modelID) return undefined
    return { providerID: provider.id, modelID }
  })

  const currentModel = createMemo(() => {
    const agent = input.agent.current()
    const sessionID = input.activeSessionID()
    const session = sessionID ? input.sync.session.get(sessionID) : undefined
    return [
      sessionID ? store.session[sessionID] : undefined,
      fromSessionModel(session?.model),
      agent ? store.model[agent.name] : undefined,
      agent?.model,
      fallbackModel(),
    ].find((model): model is ModelSelection => Boolean(model && input.isModelValid(model)))
  })

  const normalizeVariant = (model: ModelSelection, value: string | undefined) => {
    if (value === "default") return value
    if (!value) return undefined
    const variants = input.sync.data.provider.find((provider) => provider.id === model.providerID)?.models[model.modelID]?.variants
    if (!variants || !(value in variants)) return undefined
    return value
  }

  const variantListForModel = (model: ModelSelection) => {
    const variants = input.sync.data.provider.find((provider) => provider.id === model.providerID)?.models[model.modelID]?.variants
    return variants ? Object.keys(variants) : []
  }

  const selectedVariant = () => {
    const model = currentModel()
    if (!model) return undefined
    const sessionID = input.activeSessionID()
    if (sessionID && store.sessionVariant[sessionID] !== undefined) return normalizeVariant(model, store.sessionVariant[sessionID])
    const session = sessionID ? input.sync.session.get(sessionID) : undefined
    if (session?.model?.variant !== undefined) return normalizeVariant(model, session.model.variant)
    if (sessionID) return undefined
    return normalizeVariant(model, store.variant[modelSelectionKey(model)])
  }

  const canChangeModel = (next?: ModelSelection) => {
    if (!input.activeSessionSwarmID() || !input.activeSessionHasUserMessage() || sameModel(currentModel(), next)) return true
    input.toast.show({
      message: "Started swarm sessions keep their assigned model.",
      variant: "warning",
      duration: 3000,
    })
    return false
  }

  const selectModel = (model: ModelSelection) => {
    const agent = input.agent.current()
    if (!agent) return
    const sessionID = input.activeSessionID()
    if (sessionID) setStore("session", sessionID, { ...model })
    if (!sessionID) setStore("model", agent.name, { ...model })
    if (sessionID) persistSessionModel(model, undefined)
    save()
  }

  return {
    current: currentModel,
    get ready() {
      return store.ready
    },
    recent() {
      return store.recent
    },
    favorite() {
      return store.favorite
    },
    parsed: createMemo(() => {
      const value = currentModel()
      if (!value) return { provider: "Connect a provider", model: "No provider selected", reasoning: false }
      const provider = input.sync.data.provider.find((item) => item.id === value.providerID)
      const info = provider?.models[value.modelID]
      return {
        provider: provider?.name ?? value.providerID,
        model: info?.name ?? value.modelID,
        reasoning: info?.capabilities?.reasoning ?? false,
      }
    }),
    cycle(direction: 1 | -1) {
      const current = currentModel()
      if (!current) return
      const index = store.recent.findIndex((model) => sameModel(model, current))
      if (index === -1 || !store.recent.length) return
      const next = store.recent[(index + direction + store.recent.length) % store.recent.length]
      if (next && canChangeModel(next)) selectModel(next)
    },
    cycleFavorite(direction: 1 | -1) {
      const favorites = store.favorite.filter(input.isModelValid)
      if (!favorites.length) {
        input.toast.show({ variant: "info", message: "Add a favorite model to use this shortcut", duration: 3000 })
        return
      }
      const current = currentModel()
      const currentIndex = current ? favorites.findIndex((model) => sameModel(model, current)) : -1
      const index = currentIndex === -1 ? (direction === 1 ? 0 : favorites.length - 1) : (currentIndex + direction + favorites.length) % favorites.length
      const next = favorites[index]
      if (!next || !canChangeModel(next)) return
      selectModel(next)
      setStore("recent", recentModels(next, store.recent))
      save()
    },
    set(model: ModelSelection, options?: { recent?: boolean; persist?: boolean; force?: boolean }) {
      batch(() => {
        if (!input.isModelValid(model)) {
          input.toast.show({
            message: `Model ${modelSelectionKey(model)} is not valid`,
            variant: "warning",
            duration: 3000,
          })
          return
        }
        if (!options?.force && !canChangeModel(model)) return
        const agent = input.agent.current()
        if (!agent) return
        const sessionID = input.activeSessionID()
        if (sessionID) setStore("session", sessionID, model)
        if (!sessionID) setStore("model", agent.name, model)
        if (options?.recent) setStore("recent", recentModels(model, store.recent))
        if (sessionID && options?.persist !== false) persistSessionModel(model, undefined)
        save()
      })
    },
    toggleFavorite(model: ModelSelection) {
      batch(() => {
        if (!input.isModelValid(model)) {
          input.toast.show({
            message: `Model ${modelSelectionKey(model)} is not valid`,
            variant: "warning",
            duration: 3000,
          })
          return
        }
        setStore(
          "favorite",
          store.favorite.some((item) => sameModel(item, model))
            ? store.favorite.filter((item) => !sameModel(item, model))
            : [model, ...store.favorite],
        )
        save()
      })
    },
    variant: {
      selected: selectedVariant,
      selectedForSession(sessionID: string, model: ModelSelection, fallback?: string) {
        if (store.sessionVariant[sessionID] !== undefined) return normalizeVariant(model, store.sessionVariant[sessionID])
        if (fallback !== undefined) return normalizeVariant(model, fallback)
        const session = input.sync.session.get(sessionID)
        if (session?.model?.variant !== undefined) return normalizeVariant(model, session.model.variant)
        return undefined
      },
      current() {
        const value = this.selected()
        return value && this.list().includes(value) ? value : undefined
      },
      currentForSession(sessionID: string, model: ModelSelection, fallback?: string) {
        const value = this.selectedForSession(sessionID, model, fallback)
        return value && variantListForModel(model).includes(value) ? value : undefined
      },
      list() {
        const model = currentModel()
        return model ? variantListForModel(model) : []
      },
      listForModel: variantListForModel,
      set(value: string | undefined, options?: { persist?: boolean }) {
        const model = currentModel()
        if (!model) return
        const sessionID = input.activeSessionID()
        if (sessionID) {
          this.setForSession(sessionID, model, value, options)
          return
        }
        setStore("variant", modelSelectionKey(model), value ?? "default")
        save()
      },
      setForSession(
        sessionID: string,
        model: ModelSelection,
        value: string | undefined,
        options?: { persist?: boolean },
      ) {
        setStore("sessionVariant", sessionID, value ?? "default")
        if (options?.persist !== false) persistSessionModelForSession(sessionID, model, value)
        save()
      },
      cycle() {
        const variants = this.list()
        if (!variants.length) return
        const current = this.current()
        if (!current) {
          this.set(variants[0])
          return
        }
        const index = variants.indexOf(current)
        this.set(index === -1 || index === variants.length - 1 ? undefined : variants[index + 1])
      },
      cycleForSession(sessionID: string, model: ModelSelection, current?: string) {
        const variants = variantListForModel(model)
        if (!variants.length) return
        if (!current) {
          this.setForSession(sessionID, model, variants[0])
          return
        }
        const index = variants.indexOf(current)
        this.setForSession(sessionID, model, index === -1 || index === variants.length - 1 ? undefined : variants[index + 1])
      },
    },
  }
}

function fromSessionModel(model: { providerID: string; id: string } | undefined) {
  if (!model) return undefined
  return { providerID: model.providerID, modelID: model.id }
}

function recentModels(model: ModelSelection, recent: ModelSelection[]) {
  return uniqueBy([model, ...recent], modelSelectionKey)
    .slice(0, 10)
    .map((item) => ({ providerID: item.providerID, modelID: item.modelID }))
}

function readVariantMap(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value).filter((item): item is [string, string] => typeof item[1] === "string"),
  )
}
