import { createMemo, createSignal, onCleanup } from "solid-js"
import { createDebouncedTask } from "../lib/deferred-work"
import { isFreeOpencodeModel, modelValue, parseModelValue, type ModelPickerOption } from "../lib/model-selection"
import { readFavoriteModels, writeFavoriteModels } from "../lib/session-composer-helpers"
import type { SessionPageProps } from "./session-page-types"

/** Long enough that a fast typist filters the catalog once, not once per key. */
const SEARCH_DEBOUNCE_MS = 90

export function createSessionModelController(props: SessionPageProps) {
  const [pickerOpen, setPickerOpen] = createSignal(false)
  const [variantPickerOpen, setVariantPickerOpen] = createSignal(false)
  // `query` drives the input so typing stays instant; `search` drives filtering.
  const [query, setQuery] = createSignal("")
  const [search, setSearch] = createSignal("")
  const [favorites, setFavorites] = createSignal(readFavoriteModels())
  const debouncedSearch = createDebouncedTask<string>(setSearch, SEARCH_DEBOUNCE_MS)
  onCleanup(debouncedSearch.cancel)
  const options = createMemo(() =>
    props.providers.flatMap((provider) =>
      Object.values(provider.models)
        .filter((model) => model.status !== "deprecated")
        .map((model) => ({ provider, model })),
    ),
  )
  const recentOptions = createMemo(() =>
    props.recentModels.flatMap((value) => {
      const option = options().find((item) => modelValue(item.provider.id, item.model.id) === value)
      return option ? [option] : []
    }),
  )
  const favoriteOptions = createMemo(() =>
    favorites().flatMap((value) => {
      const option = options().find((item) => modelValue(item.provider.id, item.model.id) === value)
      return option ? [option] : []
    }),
  )
  // Connected providers first: those are the only ones that can answer a prompt,
  // and it keeps the auto-expanded search results on models the user can send to.
  const providerGroups = createMemo(() => {
    const recents = new Set([...recentOptions(), ...favoriteOptions()].map((item) => modelValue(item.provider.id, item.model.id)))
    const connected = new Set(props.connectedProviderIDs ?? [])
    return props.providers
      .toSorted((a, b) => Number(!connected.has(a.id)) - Number(!connected.has(b.id)) || Number(a.id !== "opencode") - Number(b.id !== "opencode") || a.name.localeCompare(b.name))
      .map((provider) => ({
        provider,
        models: Object.values(provider.models)
          .filter((model) => model.status !== "deprecated")
          .filter((model) => !recents.has(modelValue(provider.id, model.id)))
          .toSorted((a, b) => Number(!isFreeOpencodeModel(provider, a)) - Number(!isFreeOpencodeModel(provider, b)) || (a.name ?? a.id).localeCompare(b.name ?? b.id)),
      }))
      .filter((item) => item.models.length > 0)
  })
  const filteredRecentOptions = createMemo(() => filterModelOptions(recentOptions(), search()))
  const filteredFavoriteOptions = createMemo(() => filterModelOptions(favoriteOptions(), search()))
  const filteredProviderGroups = createMemo(() =>
    providerGroups()
      .map((group) => ({ provider: group.provider, models: filterProviderModels(group.provider, group.models, search()) }))
      .filter((group) => group.models.length > 0),
  )
  const activeProvider = createMemo(() => {
    const selection = parseModelValue(props.selectedModel)
    if (!selection) return
    return props.providers.find((provider) => provider.id === selection.providerID)
  })
  const activeModel = createMemo(() => {
    const selection = parseModelValue(props.selectedModel)
    if (!selection) return
    return props.providers.find((provider) => provider.id === selection.providerID)?.models[selection.modelID]
  })
  // `connectedProviderIDs` mirrors the server's live provider registry, and a
  // provider missing from it cannot resolve a model at all — the prompt dies
  // before the request is built. Catch it here instead of at send time.
  const disconnectedProvider = createMemo(() => {
    const provider = activeProvider()
    if (!provider) return undefined
    return props.connectedProviderIDs?.includes(provider.id) ? undefined : provider
  })
  const variants = createMemo(() => Object.keys(activeModel()?.variants ?? {}))
  const mode = createMemo(() => props.selectedAgent === "plan" ? "plan" : props.selectedAgent === "goal" ? "goal" : "build")
  const label = () => props.selectedModel && activeProvider() && activeModel() ? `${activeModel()!.name ?? activeModel()!.id} ${activeProvider()!.name}` : "Select model"
  const variantLabel = () => props.selectedVariant || "Default"

  function setMode(mode: "build" | "plan" | "goal") {
    props.setSelectedAgent(mode)
  }

  function toggleMode() {
    props.setSelectedAgent(mode() === "build" ? "plan" : mode() === "plan" ? "goal" : "build")
  }

  function selectVariant(variant: string) {
    props.setSelectedVariant(variant)
    setVariantPickerOpen(false)
  }

  function cycleVariant() {
    const list = variants()
    if (list.length === 0) return
    const values = ["", ...list]
    const index = values.indexOf(props.selectedVariant)
    props.setSelectedVariant(values[index >= 0 ? (index + 1) % values.length : 1])
    setVariantPickerOpen(false)
  }

  function updateQuery(value: string) {
    setQuery(value)
    // Clearing should feel instant; only narrowing pays the debounce.
    if (value.trim()) return debouncedSearch.schedule(value)
    debouncedSearch.cancel()
    setSearch(value)
  }

  function select(providerID: string, modelID: string) {
    props.setSelectedModel(modelValue(providerID, modelID))
    setPickerOpen(false)
    setVariantPickerOpen(false)
    updateQuery("")
  }

  function toggleFavorite(value: string) {
    setFavorites((current) => {
      const next = current.includes(value) ? current.filter((item) => item !== value) : [value, ...current].slice(0, 20)
      writeFavoriteModels(next)
      return next
    })
  }

  return {
    pickerOpen,
    setPickerOpen,
    variantPickerOpen,
    setVariantPickerOpen,
    query,
    setQuery: updateQuery,
    searching: () => search().trim().length > 0,
    favorites,
    filteredFavoriteOptions,
    filteredRecentOptions,
    filteredProviderGroups,
    disconnectedProvider,
    variants,
    mode,
    label,
    variantLabel,
    setMode,
    toggleMode,
    selectVariant,
    cycleVariant,
    select,
    toggleFavorite,
  }
}

function filterModelOptions(options: ModelPickerOption[], query: string) {
  const needle = query.trim().toLowerCase()
  if (!needle) return options
  return options.filter((option) => matchesModel(option.provider, option.model, needle))
}

/**
 * Returns the provider's own model objects rather than fresh `{provider, model}`
 * pairs so `<For>` keeps the rendered rows it already has when a search narrows.
 */
function filterProviderModels(provider: SessionPageProps["providers"][number], models: ModelPickerOption["model"][], query: string) {
  const needle = query.trim().toLowerCase()
  if (!needle) return models
  return models.filter((model) => matchesModel(provider, model, needle))
}

function matchesModel(provider: ModelPickerOption["provider"], model: ModelPickerOption["model"], needle: string) {
  return `${model.name ?? model.id} ${provider.name}`.toLowerCase().includes(needle)
}
