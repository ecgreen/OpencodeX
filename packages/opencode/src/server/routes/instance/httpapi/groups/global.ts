import { Config } from "@/config/config"
import { GuiBridge } from "@/opencodex/gui-bridge"
import { EventV2 } from "@opencode-ai/core/event"
import { InstanceDisposed } from "@/server/event"
import "@/server/event"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { described } from "./metadata"
import { ConflictError, ForbiddenError, InvalidRequestError } from "../errors"

const GlobalHealth = Schema.Struct({
  healthy: Schema.Literal(true),
  version: Schema.String,
  active: Schema.Boolean,
  processRole: Schema.String,
  runID: Schema.String,
  databaseID: Schema.String,
  eventBusID: Schema.String,
})

const SyncEventSchemas = EventV2.registry
  .values()
  .flatMap((definition) => {
    if (!definition.sync) return []
    return [
      Schema.Struct({
        type: Schema.Literal("sync"),
        name: Schema.Literal(EventV2.versionedType(definition.type, definition.sync.version)),
        id: Schema.String,
        seq: Schema.Finite,
        aggregateID: Schema.Literal(definition.sync.aggregate),
        data: definition.data,
      }).annotate({ identifier: `SyncEvent.${definition.type}` }),
    ]
  })
  .toArray()

const GlobalEventSchema = Schema.Struct({
  directory: Schema.String,
  project: Schema.optional(Schema.String),
  workspace: Schema.optional(Schema.String),
  payload: Schema.Union([
    ...EventV2.registry
      .values()
      .map((definition) =>
        Schema.Struct({ id: Schema.String, type: Schema.Literal(definition.type), properties: definition.data }),
      )
      .toArray(),
    InstanceDisposed,
    ...SyncEventSchemas,
  ]),
}).annotate({ identifier: "GlobalEvent" })

export const GlobalUpgradeInput = Schema.Struct({
  target: Schema.optional(Schema.String),
})

const GlobalUpgradeResult = Schema.Union([
  Schema.Struct({
    success: Schema.Literal(true),
    version: Schema.String,
  }),
  Schema.Struct({
    success: Schema.Literal(false),
    error: Schema.String,
  }),
])

export const GlobalPaths = {
  health: "/global/health",
  event: "/global/event",
  config: "/global/config",
  dispose: "/global/dispose",
  upgrade: "/global/upgrade",
  guiBridgeSync: "/global/gui-bridge/sync",
  guiBridgeUnregister: "/global/gui-bridge/unregister",
  guiBridgeRespond: "/global/gui-bridge/respond",
} as const

export const GlobalApi = HttpApi.make("global").add(
  HttpApiGroup.make("global")
    .add(
      HttpApiEndpoint.get("health", GlobalPaths.health, {
        success: described(GlobalHealth, "Health information"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.health",
          summary: "Get health",
          description: "Get health information about the OpenCode server.",
        }),
      ),
      HttpApiEndpoint.get("event", GlobalPaths.event, {
        success: GlobalEventSchema,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.event",
          summary: "Get global events",
          description: "Subscribe to global events from the OpenCode system using server-sent events.",
        }),
      ),
      HttpApiEndpoint.get("configGet", GlobalPaths.config, {
        success: described(Config.Info, "Get global config info"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.config.get",
          summary: "Get global configuration",
          description: "Retrieve the current global OpenCode configuration settings and preferences.",
        }),
      ),
      HttpApiEndpoint.patch("configUpdate", GlobalPaths.config, {
        payload: Config.Info,
        success: described(Config.Info, "Successfully updated global config"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.config.update",
          summary: "Update global configuration",
          description: "Update global OpenCode configuration settings and preferences.",
        }),
      ),
      HttpApiEndpoint.post("dispose", GlobalPaths.dispose, {
        success: described(Schema.Boolean, "Global disposed"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.dispose",
          summary: "Dispose instance",
          description: "Clean up and dispose all OpenCode instances, releasing all resources.",
        }),
      ),
      HttpApiEndpoint.post("upgrade", GlobalPaths.upgrade, {
        payload: [HttpApiSchema.NoContent, GlobalUpgradeInput],
        success: described(GlobalUpgradeResult, "Upgrade result"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.upgrade",
          summary: "Upgrade opencode",
          description: "Upgrade opencode to the specified version or latest if not specified.",
        }),
      ),
      HttpApiEndpoint.post("guiBridgeSync", GlobalPaths.guiBridgeSync, {
        payload: GuiBridge.SyncPayload,
        success: described(GuiBridge.SyncResult, "GUI bridge desired state synchronized"),
        error: [ForbiddenError, ConflictError, InvalidRequestError],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.gui_bridge.sync",
          summary: "Synchronize GUI bridge scopes",
        }),
      ),
      HttpApiEndpoint.post("guiBridgeUnregister", GlobalPaths.guiBridgeUnregister, {
        payload: GuiBridge.UnregisterPayload,
        success: described(GuiBridge.MutationResult, "GUI bridge unregistered"),
        error: [ForbiddenError, ConflictError, InvalidRequestError],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.gui_bridge.unregister",
          summary: "Unregister a GUI bridge lease",
        }),
      ),
      HttpApiEndpoint.post("guiBridgeRespond", GlobalPaths.guiBridgeRespond, {
        payload: GuiBridge.RespondPayload,
        success: described(GuiBridge.MutationResult, "GUI bridge response accepted"),
        error: [ForbiddenError, ConflictError, InvalidRequestError],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.gui_bridge.respond",
          summary: "Respond to a pending GUI bridge request",
        }),
      ),
    )
    .annotateMerge(OpenApi.annotations({ title: "global", description: "Global server routes." })),
)
