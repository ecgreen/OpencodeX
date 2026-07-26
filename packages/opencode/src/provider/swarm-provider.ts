import { ProviderV2 } from "@opencode-ai/core/provider"

/**
 * "Swarm" is a first-class provider in OpencodeX: every swarm the user has
 * built appears in the model picker as a selectable model. Selecting one routes
 * the session's turns to the swarm's orchestrator (its real model), with the
 * other roles delegated as subagents inside the same session.
 *
 * `Provider.getModel("swarm", id)` never returns these facade rows - it
 * resolves to the orchestrator's underlying model so SDK auth, pricing, and
 * context limits all come from the real provider.
 */
export const SWARM_PROVIDER_ID = ProviderV2.ID.make("swarm")

export function isSwarmProvider(providerID: string) {
  return providerID === SWARM_PROVIDER_ID
}

export type SwarmRoute = {
  swarmID: string
  title: string
  roleCount: number
  /** The orchestrator's real model; turns on `swarm/<id>` resolve to this. */
  orchestrator?: { providerID: string; modelID: string }
}

export type SwarmRow = { id: string; title: string }
export type RoleRow = { swarm_id: string; provider_id: string | null; model_id: string | null }

/** Shapes rows into routes; the first role by sort order is the orchestrator. */
export function swarmRoutes(swarms: SwarmRow[], roles: RoleRow[]): SwarmRoute[] {
  return swarms.map((swarm) => {
    const own = roles.filter((role) => role.swarm_id === swarm.id)
    const orchestrator = own[0]
    return {
      swarmID: swarm.id,
      title: swarm.title,
      roleCount: own.length,
      ...(orchestrator?.provider_id && orchestrator.model_id
        ? { orchestrator: { providerID: orchestrator.provider_id, modelID: orchestrator.model_id } }
        : {}),
    }
  })
}

export function swarmProviderInfo(routes: SwarmRoute[]) {
  return {
    id: SWARM_PROVIDER_ID,
    source: "custom" as const,
    name: "Swarm",
    env: [] as string[],
    // Not a credentialed provider; auth belongs to each role's real provider.
    options: { apiKey: "local" } as Record<string, unknown>,
    models: Object.fromEntries(routes.map((route) => [route.swarmID, swarmModel(route)])),
  }
}

/** Reads the orchestrator route back off a facade model row. */
export function swarmModelRoute(model: { options?: Record<string, unknown> } | undefined) {
  const route = model?.options?.route
  if (!route || typeof route !== "object") return undefined
  const { providerID, modelID } = route as Record<string, unknown>
  if (typeof providerID !== "string" || typeof modelID !== "string") return undefined
  return { providerID, modelID }
}

function swarmModel(route: SwarmRoute) {
  return {
    id: ProviderV2.ModelID.make(route.swarmID),
    providerID: SWARM_PROVIDER_ID,
    name: route.title,
    family: "swarm",
    api: { id: route.swarmID, url: "", npm: "" },
    status: "active" as const,
    headers: {} as Record<string, string>,
    // The orchestrator route rides along so getModel can redirect without
    // another database read.
    options: (route.orchestrator ? { route: route.orchestrator } : {}) as Record<string, unknown>,
    // Cost and limits come from the resolved orchestrator model at run time.
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: 0, output: 0 },
    capabilities: {
      temperature: false,
      reasoning: false,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: true },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    release_date: "",
    variants: {} as Record<string, unknown>,
  }
}

export * as SwarmProvider from "./swarm-provider"
