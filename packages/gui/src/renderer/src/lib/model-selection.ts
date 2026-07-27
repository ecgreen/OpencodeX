import type { Provider, Session } from "@opencode-ai/sdk/v2/client"

export type ModelPickerOption = { provider: Provider; model: Provider["models"][string] }

/**
 * Synthetic provider whose models are the user's swarms. Swarms get their own
 * picker section and are excluded from generic provider lists so they never
 * become an accidental default or a role's underlying model.
 */
export const SWARM_PROVIDER_ID = "swarm"

export function isSwarmModelValue(value: string) {
  return parseModelValue(value)?.providerID === SWARM_PROVIDER_ID
}

export function swarmModelValue(swarmID: string) {
  return modelValue(SWARM_PROVIDER_ID, swarmID)
}

export function modelValue(providerID: string, modelID: string) {
  return `${providerID}/${modelID}`
}

export function parseModelValue(value: string) {
  const index = value.indexOf("/")
  if (index === -1) return undefined
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

export function modelPickerProviders(
  providers: Provider[],
  connectedProviderIDs: string[],
  selectedProviderIDs: string[] = [],
) {
  const visible = new Set(["opencode", ...connectedProviderIDs, ...selectedProviderIDs.filter(Boolean)])
  const available = providers
    .filter(
      (provider) =>
        provider.id !== SWARM_PROVIDER_ID &&
        visible.has(provider.id) && Object.values(provider.models).some((model) => model.status !== "deprecated"),
    )
    .toSorted((a, b) => Number(a.id !== "opencode") - Number(b.id !== "opencode") || a.name.localeCompare(b.name))
  if (available.length > 0) return available
  const fallback = modelPickerOptions(providers)[0]?.provider
  return fallback ? [fallback] : []
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
    .filter((item) => item.id !== SWARM_PROVIDER_ID)
    .toSorted((a, b) => Number(a.id !== "opencode") - Number(b.id !== "opencode") || a.name.localeCompare(b.name))
    .find((item) => Object.values(item.models).some((model) => model.status !== "deprecated"))
  const model = provider ? Object.values(provider.models).filter((item) => item.status !== "deprecated").toSorted((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id))[0] : undefined
  if (!provider || !model) return undefined
  return modelValue(provider.id, model.id)
}

export function isFreeOpencodeModel(provider: Provider, model: Provider["models"][string]) {
  return provider.id === "opencode" && model.cost?.input === 0
}
