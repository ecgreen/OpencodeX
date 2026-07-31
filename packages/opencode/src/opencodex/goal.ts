import { Database } from "@opencode-ai/core/database/database"
import { EventV2Bridge } from "@/event-v2-bridge"
import { OpencodeXJob } from "@/opencodex/job"
import { OpencodeXProject } from "@/opencodex/project"
import { Effect, Layer } from "effect"
import { goalDispatchLayer } from "./goal-dispatch"
import { goalServiceLayer } from "./goal-service"
import { goalStoreLayer, GoalStoreService } from "./goal-store"
import { ReadService, Service } from "./goal-schema"

export {
  Budget,
  CreateInput,
  Edge,
  EdgeInput,
  EdgeKind,
  Executor,
  Info,
  Loop,
  Metadata,
  Node,
  NodeInput,
  NodeKind,
  NodeStatus,
  NotFoundError,
  NodeNotFoundError,
  PlanInput,
  ReadService,
  ReportInput,
  Schedule,
  Service,
  Spend,
  StateEvent,
  Status,
  TERMINAL_NODE_STATUSES,
  TERMINAL_STATUSES,
  UpdatePlanInput,
  ValidationError,
  Verdict,
} from "./goal-schema"
export type { Interface, ReadInterface } from "./goal-schema"
export { GOAL_NODE_JOB_KIND, GoalDispatch } from "./goal-dispatch"
export { GoalStoreService, goalStoreLayer } from "./goal-store"
export { buildPlannerBrief } from "./goal-prompt"

const storeLayer = goalStoreLayer

/** The read half, for callers that must not pull the execution graph in. */
export const readLayer = Layer.effect(
  ReadService,
  Effect.gen(function* () {
    const store = yield* GoalStoreService
    return ReadService.of({ list: store.list, get: store.get })
  }),
).pipe(Layer.provideMerge(storeLayer))

/**
 * Planning and reconciling, with its dependencies left to the caller. Nothing
 * here builds a second Database, project registry, or session service: the
 * graph tools live in the tool registry, and a duplicate instance there would
 * quietly resolve to different config than the loop around it.
 *
 * It is also free of the prompt loop on purpose - the tools that use this
 * service are built by that loop, so depending on it would be a cycle.
 */
export const layer = goalServiceLayer.pipe(Layer.provideMerge(goalDispatchLayer), Layer.provideMerge(readLayer))

/** The same thing with the standard dependencies, for app boundaries. */
export const defaultLayer = layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      Database.defaultLayer,
      EventV2Bridge.defaultLayer,
      OpencodeXJob.defaultLayer,
      OpencodeXProject.defaultLayer,
    ),
  ),
)

export const storeOnlyLayer = goalStoreLayer

export * as OpencodeXGoal from "./goal"
