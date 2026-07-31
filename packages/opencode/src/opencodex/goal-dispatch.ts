import { Database } from "@opencode-ai/core/database/database"
import { OpencodeXGoalNodeTable, OpencodeXGoalTable } from "@opencode-ai/core/opencodex/sql"
import { EventV2Bridge } from "@/event-v2-bridge"
import { OpencodeXJob } from "@/opencodex/job"
import { and, eq, inArray } from "drizzle-orm"
import { Context, Effect, Layer, Semaphore } from "effect"
import { parseSpend } from "./goal-model"
import { advanceSchedule, planReconcile, scheduleDue } from "./goal-reconcile"
import { GoalStoreService, type NodePatch } from "./goal-store"
import { StateEvent, TERMINAL_STATUSES, type Info, type NodeStatus } from "./goal-schema"

/**
 * The runtime that walks a graph: it applies the reconciler's plan, enqueues
 * ready nodes as durable jobs, and folds each settled job back into the graph.
 * Deliberately dumb - every judgement call it makes came from `planReconcile`.
 *
 * It deliberately does not know how to *run* a node. Node execution needs the
 * prompt loop, the prompt loop needs the tool registry, and the tools need this
 * service to plan with - so execution is registered separately (goal-runtime)
 * and this layer stays free of that cycle.
 */

export const GOAL_NODE_JOB_KIND = "goal.node"
/** Nodes get one wall-clock hour before the job layer reclaims the lease. */
const NODE_TIMEOUT_MS = 60 * 60 * 1_000

export interface Interface {
  readonly reconcile: (goalID: string) => Effect.Effect<void>
  readonly reconcileAll: () => Effect.Effect<void>
  /** Re-instantiates the graph of every standing goal whose cadence is due. */
  readonly sweepSchedules: (now?: number) => Effect.Effect<string[]>
  readonly settleNode: OpencodeXJob.TransactionalSettlement
}

export class GoalDispatch extends Context.Service<GoalDispatch, Interface>()("@opencode/OpencodeXGoalDispatch") {}

export const goalDispatchLayer = Layer.effect(
  GoalDispatch,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const events = yield* EventV2Bridge.Service
    const store = yield* GoalStoreService
    const jobs = yield* OpencodeXJob.Service
    // One reconcile at a time per goal: two passes racing would both see the
    // same ready node. The job idempotency key is the second line of defence.
    const locks = new Map<string, Semaphore.Semaphore>()

    function lock(goalID: string) {
      const existing = locks.get(goalID)
      if (existing) return existing
      const created = Semaphore.makeUnsafe(1)
      locks.set(goalID, created)
      return created
    }

    const reconcileUnlocked = Effect.fnUntraced(function* (goalID: string) {
      const goal = yield* store.get(goalID).pipe(Effect.option)
      if (goal._tag === "None") return
      const plan = planReconcile({ goal: goal.value, now: Date.now() })
      const patches: { nodeID: string; patch: NodePatch }[] = []
      const now = Date.now()

      for (const nodeID of plan.skip) {
        patches.push({ nodeID, patch: { status: "skipped", completedAt: now } })
      }
      for (const nodeID of plan.gates) {
        patches.push({ nodeID, patch: { status: "awaiting_approval" } })
      }
      for (const action of plan.loops) {
        const node = goal.value.nodes.find((item) => item.id === action.nodeID)
        if (!node?.loop) continue
        if (action.type === "start") {
          patches.push({
            nodeID: action.nodeID,
            patch: {
              status: "running",
              startedAt: now,
              loop: { ...node.loop, iteration: action.iteration },
              iteration: action.iteration,
            },
          })
          for (const bodyID of action.resetNodeIDs) {
            patches.push({ nodeID: bodyID, patch: { iteration: action.iteration } })
          }
          continue
        }
        if (action.type === "advance") {
          patches.push({
            nodeID: action.nodeID,
            patch: {
              loop: { ...node.loop, iteration: action.iteration, lastReport: action.report },
              iteration: action.iteration,
            },
          })
          for (const bodyID of action.resetNodeIDs) {
            patches.push({
              nodeID: bodyID,
              patch: {
                status: "planned",
                iteration: action.iteration,
                jobID: null,
                sessionID: null,
                deliveredPrompt: null,
                result: null,
                verdict: null,
                failureReason: null,
                startedAt: null,
                completedAt: null,
              },
            })
          }
          continue
        }
        patches.push({
          nodeID: action.nodeID,
          patch: {
            status: action.status,
            completedAt: now,
            ...(action.status === "done" ? { result: action.report } : { failureReason: action.report }),
          },
        })
      }

      const goalPatch = plan.goal
        ? {
            status: plan.goal.status,
            statusReason: plan.goal.reason ?? null,
            ...(plan.goal.status === "running" && !goal.value.startedAt ? { startedAt: now } : {}),
            ...(TERMINAL_STATUSES.includes(plan.goal.status) ? { completedAt: now } : {}),
          }
        : undefined
      if (patches.length > 0 || goalPatch) {
        yield* store.patchNodes(goalID, patches, goalPatch).pipe(Effect.ignore)
      }

      if (plan.dispatch.length === 0) return
      // Re-read so each new job records the iteration the patches just wrote.
      const current = yield* store.get(goalID).pipe(Effect.orDie)
      // Creating a job broadcasts a job event, which is what wakes the job
      // dispatcher - no explicit poke, and no dependency on it from here.
      yield* Effect.forEach(plan.dispatch, (nodeID) => enqueue(current, nodeID), { concurrency: 1, discard: true })
    })

    const enqueue = Effect.fnUntraced(function* (goal: Info, nodeID: string) {
      const node = goal.nodes.find((item) => item.id === nodeID)
      if (!node) return
      const job = yield* jobs.create({
        kind: GOAL_NODE_JOB_KIND,
        title: `${goal.title}: ${node.title}`,
        source: goal.source,
        projectID: goal.projectID,
        ...(goal.swarmID ? { swarmID: goal.swarmID } : {}),
        // One job per node per iteration: a re-reconcile before the job runs
        // finds the existing job instead of starting a second one.
        idempotencyKey: `${goal.id}:${node.id}:${node.iteration}`,
        maxAttempts: node.kind === "check" ? 2 : 3,
        timeoutAt: Date.now() + NODE_TIMEOUT_MS,
        metadata: { goalID: goal.id, nodeID: node.id, iteration: node.iteration },
      })
      yield* store
        .patchNodes(goal.id, [{ nodeID: node.id, patch: { status: "dispatched", jobID: job.id } }])
        .pipe(Effect.ignore)
    })

    const reconcile = Effect.fn("OpencodeXGoal.reconcile")(function* (goalID: string) {
      yield* lock(goalID).withPermits(1)(reconcileUnlocked(goalID))
    })

    const reconcileAll = Effect.fn("OpencodeXGoal.reconcileAll")(function* () {
      const goals = yield* store.list()
      yield* Effect.forEach(
        goals.filter((goal) => !TERMINAL_STATUSES.includes(goal.status) && goal.status !== "draft"),
        (goal) => reconcile(goal.id),
        { concurrency: 1, discard: true },
      )
    })

    /**
     * Folds a settled job into its node inside the job's own settle
     * transaction, so a node can never disagree with the job that ran it.
     */
    const settleNode: OpencodeXJob.TransactionalSettlement = (job, transaction) =>
      Effect.gen(function* () {
        const goalID = typeof job.metadata?.goalID === "string" ? job.metadata.goalID : undefined
        const nodeID = typeof job.metadata?.nodeID === "string" ? job.metadata.nodeID : undefined
        if (!goalID || !nodeID) return Effect.void
        const status: NodeStatus =
          job.status === "succeeded" ? "done" : job.status === "cancelled" ? "cancelled" : "failed"
        const now = job.completedAt ?? Date.now()
        const updated = yield* transaction
          .update(OpencodeXGoalNodeTable)
          .set({
            status,
            completed_at: now,
            time_updated: now,
            ...(status === "failed"
              ? { failure_reason: job.failure?.message ?? job.statusReason ?? "Node execution failed" }
              : {}),
          })
          .where(
            and(
              eq(OpencodeXGoalNodeTable.goal_id, goalID),
              eq(OpencodeXGoalNodeTable.id, nodeID),
              // Only the job that owns the node settles it; a stale retry must
              // not overwrite a newer iteration's state.
              eq(OpencodeXGoalNodeTable.job_id, job.id),
              inArray(OpencodeXGoalNodeTable.status, ["dispatched", "running"]),
            ),
          )
          .returning({ id: OpencodeXGoalNodeTable.id })
          .get()
        if (!updated) return Effect.void
        yield* chargeSpend(transaction, goalID, job)
        const committed = yield* events.commit(StateEvent.Updated, { goalID })
        // This runs after the job's transaction commits, so it must not fail
        // the settlement - but a reconcile that dies silently would stall the
        // graph with nothing to look at, so it is logged rather than dropped.
        return events.broadcast(committed).pipe(
          Effect.andThen(reconcile(goalID)),
          Effect.catchCause((cause) => Effect.logError("goal reconcile after settlement failed", { goalID, cause })),
        )
      }).pipe(Effect.orDie)

    /** Budgets are only honest if every finished node is charged for. */
    const chargeSpend = Effect.fnUntraced(function* (
      transaction: OpencodeXJob.Transaction,
      goalID: string,
      job: OpencodeXJob.Info,
    ) {
      const row = yield* transaction
        .select({ spend: OpencodeXGoalTable.spend_json })
        .from(OpencodeXGoalTable)
        .where(eq(OpencodeXGoalTable.id, goalID))
        .get()
      if (!row) return
      const spend = parseSpend(row.spend)
      const cost = typeof job.result?.costUsd === "number" ? job.result.costUsd : 0
      yield* transaction
        .update(OpencodeXGoalTable)
        .set({
          spend_json: JSON.stringify({ nodeRuns: spend.nodeRuns + 1, costUsd: spend.costUsd + cost }),
          time_updated: Date.now(),
        })
        .where(eq(OpencodeXGoalTable.id, goalID))
        .run()
    })

    /**
     * A standing goal keeps its plan and runs it again: the nodes reset to
     * planned, the spend resets with them, and the previous run survives in
     * the jobs and child sessions it created.
     */
    const restart = Effect.fnUntraced(function* (goal: Info, now: number) {
      yield* store.patchNodes(
        goal.id,
        goal.nodes.map((node) => ({
          nodeID: node.id,
          patch: {
            status: "planned" as const,
            iteration: 0,
            jobID: null,
            sessionID: null,
            deliveredPrompt: null,
            result: null,
            verdict: null,
            failureReason: null,
            startedAt: null,
            completedAt: null,
            ...(node.loop ? { loop: { ...node.loop, iteration: 0, lastReport: undefined } } : {}),
          },
        })),
        {
          status: "running",
          statusReason: null,
          startedAt: now,
          completedAt: null,
          spend: { nodeRuns: 0, costUsd: 0 },
          schedule: advanceSchedule(goal.schedule!, now),
        },
      )
      yield* reconcile(goal.id)
    })

    const sweepSchedules = Effect.fn("OpencodeXGoal.sweepSchedules")(function* (now = Date.now()) {
      const goals = yield* store.list()
      const due = goals.filter((goal) =>
        scheduleDue({ goal: { status: goal.status, schedule: goal.schedule, nodeCount: goal.nodes.length }, now }),
      )
      yield* Effect.forEach(due, (goal) => restart(goal, now).pipe(Effect.ignore), { concurrency: 1, discard: true })
      return due.map((goal) => goal.id)
    })

    return GoalDispatch.of({ reconcile, reconcileAll, sweepSchedules, settleNode })
  }),
)
