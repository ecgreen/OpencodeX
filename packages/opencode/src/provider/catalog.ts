import { Config } from "@/config/config"
import { ModelsDev } from "@opencode-ai/core/models-dev"
import { Effect } from "effect"
import { mapValues } from "remeda"
import { Provider } from "./provider"

export const list = Effect.fn("ProviderCatalog.list")(function* () {
  const config = yield* Config.Service.use((service) => service.get())
  const all = yield* ModelsDev.Service.use((service) => service.get())
  const disabled = new Set(config.disabled_providers ?? [])
  const enabled = config.enabled_providers ? new Set(config.enabled_providers) : undefined
  const filtered = Object.fromEntries(
    Object.entries(all).filter(([key]) => (enabled ? enabled.has(key) : true) && !disabled.has(key)),
  )
  const connected = yield* Provider.Service.use((service) => service.list())
  const providers = Object.assign(
    mapValues(filtered, (item) => Provider.fromModelsDevProvider(item)),
    connected,
  )
  return {
    all: Object.values(providers).map(Provider.toPublicInfo),
    default: Provider.defaultModelIDs(providers),
    connected: Object.keys(connected),
  }
})

export * as ProviderCatalog from "./catalog"
