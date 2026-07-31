import { Database } from "@opencode-ai/core/database/database"
import { EventV2Bridge } from "@/event-v2-bridge"
import { OpencodeXJob } from "@/opencodex/job"
import { OpencodeXProject } from "@/opencodex/project"
import { Effect, Layer } from "effect"
import { SwarmMutations, swarmMutationsLayer } from "./swarm-mutations"
import { planLayer } from "./swarm-plan-layer"
import { readLayer } from "./swarm-read-layer"
import { ReadService, Service } from "./swarm-schema"
import { SwarmStatus, swarmStatusLayer } from "./swarm-status"

export {
  CreateInput,
  Event,
  Info,
  Metadata,
  Role,
  RoleInput,
  RoleStatus,
  Status,
  UpdateInput,
  AddRoleInput,
  UpdateRoleInput,
  StateEvent,
  NotFoundError,
  RoleNotFoundError,
  ValidationError,
  Service,
  ReadService,
  PlanService,
} from "./swarm-schema"
export type { Interface, ReadInterface, PlanInterface } from "./swarm-schema"
export { planLayer } from "./swarm-plan-layer"
export { readLayer } from "./swarm-read-layer"

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const reader = yield* ReadService
    const mutations = yield* SwarmMutations
    yield* SwarmStatus
    return Service.of({
      list: reader.list,
      get: reader.get,
      create: mutations.create,
      update: mutations.update,
      cancel: mutations.cancel,
      remove: mutations.remove,
      addRole: mutations.addRole,
      updateRole: mutations.updateRole,
    })
  }),
)

const foundationLayer = Layer.mergeAll(
  Database.defaultLayer,
  EventV2Bridge.defaultLayer,
  OpencodeXJob.defaultLayer,
  OpencodeXProject.defaultLayer,
  readLayer.pipe(Layer.provide(Database.defaultLayer)),
  planLayer.pipe(
    Layer.provide(Database.defaultLayer),
    Layer.provide(EventV2Bridge.defaultLayer),
    Layer.provide(OpencodeXProject.defaultLayer),
  ),
)

const statusRuntimeLayer = swarmStatusLayer.pipe(Layer.provideMerge(foundationLayer))
const mutationsRuntimeLayer = swarmMutationsLayer.pipe(Layer.provideMerge(statusRuntimeLayer))

export const defaultLayer = layer.pipe(Layer.provide(mutationsRuntimeLayer))

export * as OpencodeXSwarm from "./swarm"
