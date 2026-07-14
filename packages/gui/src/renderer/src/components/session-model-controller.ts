import { createMemo, createSignal } from "solid-js"
import { isFreeOpencodeModel, modelValue, parseModelValue, type ModelPickerOption } from "../lib/model-selection"
import { readFavoriteModels, writeFavoriteModels } from "../lib/session-composer-helpers"
import type { SessionPageProps } from "./session-page-types"

export function createSessionModelController(props: SessionPageProps) {
  const [pickerOpen, setPickerOpen] = createSignal(false)
  const [variantPickerOpen, setVariantPickerOpen] = createSignal(false)
  const [query, setQuery] = createSignal("")
  const [favorites, setFavorites] = createSignal(readFavoriteModels())
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
  const providerGroups = createMemo(() => {
    const recents = new Set([...recentOptions(), ...favoriteOptions()].map((item) => modelValue(item.provider.id, item.model.id)))
    return props.providers
      .toSorted((a, b) => Number(a.id !== "opencode") - Number(b.id !== "opencode") || a.name.localeCompare(b.name))
      .map((provider) => ({
        provider,
        models: Object.values(provider.models)
          .filter((model) => model.status !== "deprecated")
          .filter((model) => !recents.has(modelValue(provider.id, model.id)))
          .toSorted((a, b) => Number(!isFreeOpencodeModel(provider, a)) - Number(!isFreeOpencodeModel(provider, b)) || (a.name ?? a.id).localeCompare(b.name ?? b.id)),
      }))
      .filter((item) => item.models.length > 0)
  })
  const filteredRecentOptions = createMemo(() => filterModelOptions(recentOptions(), query()))
  const filteredFavoriteOptions = createMemo(() => filterModelOptions(favoriteOptions(), query()))
  const filteredProviderGroups = createMemo(() =>
    providerGroups()
      .map((group) => ({ ...group, models: filterModelOptions(group.models.map((model) => ({ provider: group.provider, model })), query()).map((item) => item.model) }))
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

  function select(providerID: string, modelID: string) {
    props.setSelectedModel(modelValue(providerID, modelID))
    setPickerOpen(false)
    setVariantPickerOpen(false)
    setQuery("")
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
    setQuery,
    favorites,
    filteredFavoriteOptions,
    filteredRecentOptions,
    filteredProviderGroups,
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
  return options.filter((option) => `${option.model.name ?? option.model.id} ${option.provider.name}`.toLowerCase().includes(needle))
}
