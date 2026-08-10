import { Effect, Schema } from "effect"
import { InstanceRef, WorkspaceRef } from "@/effect/instance-ref"
import { ServerAuth } from "@/server/auth"
import { type WorkspaceAdapter, type WorkspaceAdapterContext, type WorkspaceInfo, WorkspaceListedInfo } from "../types"

// Serialized shape persisted on the workspace row. `username`/`password` mirror
// the config module so `ServerAuth.headers` falls back to the shared env vars
// when a field is absent.
export const HubExtra = Schema.Struct({
  url: Schema.String,
  username: Schema.optional(Schema.String),
  password: Schema.optional(Schema.String),
})
export type HubExtra = Schema.Schema.Type<typeof HubExtra>

const decodeHubExtra = Schema.decodeUnknownSync(HubExtra)

export const HubConfigInline = Schema.Struct({
  url: Schema.String,
  username: Schema.optional(Schema.String),
  password: Schema.optional(Schema.String),
})
const decodeHubInline = Schema.decodeUnknownSync(HubConfigInline)

function requireInstance(context: WorkspaceAdapterContext | undefined) {
  if (!context?.instance) throw new Error("Hub adapter requires an instance context")
  return context.instance
}

const provideContext = <A, E, R>(effect: Effect.Effect<A, E, R>, context: WorkspaceAdapterContext | undefined) =>
  effect.pipe(
    Effect.provideService(InstanceRef, requireInstance(context)),
    Effect.provideService(WorkspaceRef, context?.workspaceID),
  )

// Env overrides sit on top of the config file, so an operator can point a
// running instance at a different hub without editing `opencode.json`.
function resolvedHub(inline: HubExtra): HubExtra {
  return {
    url: process.env.OPENCODE_HUB_URL ?? inline.url,
    username: inline.username,
    password: process.env.OPENCODE_HUB_PASSWORD ?? inline.password,
  }
}

function hubName(url: string) {
  return `hub@${new URL(url).host}`
}

async function loadHub() {
  const [{ AppRuntime }, { Config }] = await Promise.all([import("@/effect/app-runtime"), import("@/config/config")])
  return { AppRuntime, Config }
}

async function hubFromConfig(context: WorkspaceAdapterContext | undefined): Promise<HubExtra | undefined> {
  const { AppRuntime, Config } = await loadHub()
  const config = await AppRuntime.runPromise(
    provideContext(Config.Service.use((svc) => svc.get()), context),
  ).catch(() => undefined)
  if (!config?.hub?.url) return undefined
  return resolvedHub(decodeHubInline(config.hub))
}

export const HubAdapter: WorkspaceAdapter = {
  name: "Hub",
  description: "Mirror an always-on opencode hub server",
  async configure(info, context) {
    const instance = requireInstance(context)
    const hub = (await hubFromConfig(context)) ?? decodeHubExtra(info.extra ?? {})
    return {
      ...info,
      name: hubName(hub.url),
      directory: instance.directory,
      extra: hub,
    }
  },
  async create() {},
  async list(context) {
    const instance = requireInstance(context)
    const hub = await hubFromConfig(context)
    if (!hub) return []
    return [
      {
        type: "hub",
        name: hubName(hub.url),
        directory: instance.directory,
        extra: hub,
        projectID: instance.project.id,
      } satisfies WorkspaceListedInfo,
    ]
  },
  async remove() {},
  target(info) {
    const hub = resolvedHub(decodeHubExtra(info.extra ?? {}))
    return {
      type: "remote",
      url: hub.url,
      headers: ServerAuth.headers({ username: hub.username, password: hub.password }),
    }
  },
}