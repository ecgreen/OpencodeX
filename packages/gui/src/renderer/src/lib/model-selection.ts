import type { Provider, Session } from "@opencode-ai/sdk/v2/client"

export type ModelPickerOption = { provider: Provider; model: Provider["models"][string] }

export function modelValue(providerID: string, modelID: string) {
  return `${providerID}/${modelID}`
}

export function parseModelValue(value: string) {
  const index = value.indexOf("/")
  if (index === -1) return
  return { providerID: value.slice(0, index), modelID: value.slice(index + 1) }
}

export function modelPickerOptions(providers: Provider[]): ModelPickerOption[] {
  return providers
    .toSorted((a, b) => Number(a.id !== "opencode") - Number(b.id !== "opencode") || a.name.localeCompare(b.name))
    .flatMap((provider) =>
      Object.values(provider.models)
        .filter((model) => model.status !== "deprecated")
        .toSorted((a, b) => Number(!isFreeOpencodeModel(provider, a)) - Number(!isFreeOpencodeModel(provider, b)) || (a.name ?? a.id).localeCompare(b.name ?? b.id))
        .map((model) => ({ provider, model })),
    )
}

export function selectedModelVariants(providers: Provider[], selectedModel: string) {
  const selection = parseModelValue(selectedModel)
  if (!selection) return []
  return Object.keys(providers.find((provider) => provider.id === selection.providerID)?.models[selection.modelID]?.variants ?? {})
}

export function sessionModelDefaults(session: Session, recentModels: string[], providers: Provider[]) {
  return {
    agent: session.agent ?? "",
    model: session.model ? modelValue(session.model.providerID, session.model.id) : recentModels[0] ?? firstAvailableModel(providers) ?? "",
    variant: session.model?.variant ?? "",
  }
}

export function firstAvailableModel(providers: Provider[]) {
  const provider = providers
    .toSorted((a, b) => Number(a.id !== "opencode") - Number(b.id !== "opencode") || a.name.localeCompare(b.name))
    .find((item) => Object.values(item.models).some((model) => model.status !== "deprecated"))
  const model = provider ? Object.values(provider.models).filter((item) => item.status !== "deprecated").toSorted((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id))[0] : undefined
  if (!provider || !model) return undefined
  return modelValue(provider.id, model.id)
}

export function isFreeOpencodeModel(provider: Provider, model: Provider["models"][string]) {
  return provider.id === "opencode" && model.cost?.input === 0
}
