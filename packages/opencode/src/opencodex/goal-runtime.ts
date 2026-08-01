import { Database } from "@opencode-ai/core/database/database"
import { EventV2Bridge } from "@/event-v2-bridge"
import { InstanceBootstrap } from "@/project/bootstrap"
import { InstanceStore } from "@/project/instance-store"
import { OpencodeXJob } from "@/opencodex/job"
import { OpencodeXJobDispatcher } from "@/opencodex/job-dispatcher"
import { OpencodeXProject } from "@/opencodex/project"
import { Provider } from "@/provider/provider"
import { Session } from "@/session/session"
import { SessionPrompt } from "@/session/prompt"
import { Skill } from "@/skill"
import { Context, Effect, Layer, Schedule, Scope } from "effect"
import { GOAL_NODE_JOB_KIND, GoalDispatch } from "./goal-dispatch"
import { GoalExecution, goalExecutionLayer } from "./goal-execution"
import { OpencodeXGoal } from "./goal"

/**
 * Where planning meets running. The goal service can be built anywhere - it
 * only talks to the store and the job queue - but executing a node needs the
 * prompt loop, which builds the tool registry, which imports the goal service
 * for its graph tools. So the executing half lives here, outside that cycle,
 * and is provided once by the process that runs jobs.
 */

/** How often standing goals are checked. Cadences are minutes-and-up. */
const SCHEDULE_TICK_MS = 30_000

export class GoalRuntime extends Context.Service<GoalRuntime, { readonly kind: string }>()(
  "@opencode/OpencodeXGoalRuntime",
) {}

export const layer = Layer.effect(
  GoalRuntime,
  Effect.gen(function* () {
    const dispatcher = yield* OpencodeXJobDispatcher.Service
    const dispatch = yield* GoalDispatch
    const execution = yield* GoalExecution
    const unregister = yield* dispatcher.register(GOAL_NODE_JOB_KIND, execution.executeNode, dispatch.settleNode)
    yield* Effect.addFinalizer(() => unregister)
    // A restart leaves goals mid-graph. One sweep re-dispatches whatever the
    // crash interrupted, because readiness is recomputed from state rather
    // than remembered - a node whose job vanished simply looks ready again.
    yield* dispatch.reconcileAll().pipe(Effect.ignore)
    // Standing goals have no session to wake them, so a slow tick is what
    // starts them. The cadence itself lives on each goal.
    const scope = yield* Scope.Scope
    yield* Effect.sleep(SCHEDULE_TICK_MS).pipe(
      Effect.andThen(dispatch.sweepSchedules().pipe(Effect.ignore)),
      Effect.repeat(Schedule.forever),
      Effect.forkIn(scope),
    )
    return GoalRuntime.of({ kind: GOAL_NODE_JOB_KIND })
  }),
)

const executionLayer = goalExecutionLayer.pipe(
  Layer.provide(
    Layer.mergeAll(
      Database.defaultLayer,
      InstanceStore.defaultLayer.pipe(Layer.provide(InstanceBootstrap.defaultLayer)),
      OpencodeXJob.defaultLayer,
      OpencodeXProject.defaultLayer,
      Provider.defaultLayer,
      Session.defaultLayer,
      SessionPrompt.defaultLayer,
      Skill.defaultLayer,
      OpencodeXGoal.storeOnlyLayer,
    ),
  ),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Layer.mergeAll(executionLayer, OpencodeXGoal.defaultLayer, OpencodeXJobDispatcher.defaultLayer)),
  Layer.provide(Layer.mergeAll(Database.defaultLayer, EventV2Bridge.defaultLayer, OpencodeXJob.defaultLayer)),
)

export * as OpencodeXGoalRuntime from "./goal-runtime"
