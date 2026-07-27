import type { Provider } from "@opencode-ai/sdk/v2/client"
import { SWARM_PROVIDER_ID } from "../lib/model-selection"
import { createSessionModelController } from "./session-model-controller"
import { SessionModelPicker } from "./session-model-picker"

/**
 * The session model picker, aimed at a single swarm role. Swarm facade models
 * are excluded - a role inside a team cannot itself be a team.
 */
export function SwarmRoleModelPicker(props: {
  providers: Provider[]
  connectedProviderIDs: string[]
  recentModels: string[]
  selectedModel: string
  select: (providerID: string, modelID: string) => void
  close: () => void
  connectProvider?: (providerID?: string) => void
}) {
  const models = createSessionModelController({
    get providers() {
      return props.providers.filter((provider) => provider.id !== SWARM_PROVIDER_ID)
    },
    get connectedProviderIDs() {
      return props.connectedProviderIDs
    },
    swarms: [],
    get recentModels() {
      return props.recentModels
    },
    get selectedModel() {
      return props.selectedModel
    },
    selectedAgent: "",
    selectedVariant: "",
    setSelectedAgent: () => {},
    setSelectedModel: () => {},
    setSelectedVariant: () => {},
  })
  return (
    <SessionModelPicker
      query={models.query()}
      searching={models.searching()}
      swarmOptions={[]}
      favorites={models.favorites()}
      selectedModel={props.selectedModel}
      favoriteOptions={models.filteredFavoriteOptions()}
      recentOptions={models.filteredRecentOptions()}
      providerGroups={models.filteredProviderGroups()}
      connectedProviderIDs={props.connectedProviderIDs}
      close={props.close}
      setQuery={models.setQuery}
      select={(providerID, modelID) => {
        props.select(providerID, modelID)
        props.close()
      }}
      toggleFavorite={models.toggleFavorite}
      connectProvider={props.connectProvider}
    />
  )
}
