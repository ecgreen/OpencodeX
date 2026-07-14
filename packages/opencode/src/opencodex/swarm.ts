import { Database } from "@opencode-ai/core/database/database"
import { Agent } from "@/agent/agent"
import { BackgroundJob } from "@/background/job"
import { EventV2Bridge } from "@/event-v2-bridge"
import { OpencodeXJob } from "@/opencodex/job"
import { OpencodeXJobDispatcher } from "@/opencodex/job-dispatcher"
import { OpencodeXProject } from "@/opencodex/project"
import { Provider } from "@/provider/provider"
import { Session } from "@/session/session"
import { SessionPrompt } from "@/session/prompt"
import { Effect, Layer } from "effect"
import { SwarmExecution, swarmExecutionLayer } from "./swarm-execution"
import { SwarmMutations, swarmMutationsLayer } from "./swarm-mutations"
import { planLayer } from "./swarm-plan-layer"
import { readLayer } from "./swarm-read-layer"
import { reconcileInterruptedRuns, registerExecutors } from "./swarm-reconcile"
import { SwarmRun, swarmRunLayer } from "./swarm-run"
import { ReadService, Service } from "./swarm-schema"
import { SwarmStatus, swarmStatusLayer } from "./swarm-status"

export {
  AgentRun,
  CreateInput,
  Event,
  Info,
  Metadata,
  Role,
  RoleInput,
  RoleStatus,
  Run,
  Status,
  UpdateInput,
  AssignTaskInput,
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
    const run = yield* SwarmRun
    yield* SwarmExecution
    yield* SwarmStatus
    yield* registerExecutors()
    yield* reconcileInterruptedRuns()
    return Service.of({
      list: reader.list,
      get: reader.get,
      create: mutations.create,
      update: mutations.update,
      start: run.start,
      assignTask: run.assignTask,
      cancel: mutations.cancel,
      remove: mutations.remove,
      addRole: mutations.addRole,
      updateRole: mutations.updateRole,
    })
  }),
)

const foundationLayer = Layer.mergeAll(
  Agent.defaultLayer,
  BackgroundJob.defaultLayer,
  Database.defaultLayer,
  EventV2Bridge.defaultLayer,
  OpencodeXJob.defaultLayer,
  OpencodeXJobDispatcher.defaultLayer,
  OpencodeXProject.defaultLayer,
  Provider.defaultLayer,
  Session.defaultLayer,
  SessionPrompt.defaultLayer,
  readLayer.pipe(Layer.provide(Database.defaultLayer)),
  planLayer.pipe(
    Layer.provide(Database.defaultLayer),
    Layer.provide(EventV2Bridge.defaultLayer),
    Layer.provide(OpencodeXProject.defaultLayer),
  ),
)

const statusRuntimeLayer = swarmStatusLayer.pipe(Layer.provideMerge(foundationLayer))
const executionRuntimeLayer = swarmExecutionLayer.pipe(Layer.provideMerge(statusRuntimeLayer))
const runRuntimeLayer = swarmRunLayer.pipe(Layer.provideMerge(executionRuntimeLayer))
const mutationsRuntimeLayer = swarmMutationsLayer.pipe(Layer.provideMerge(runRuntimeLayer))

export const defaultLayer = layer.pipe(Layer.provide(mutationsRuntimeLayer))

export * as OpencodeXSwarm from "./swarm"
