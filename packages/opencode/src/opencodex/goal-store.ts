import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import {
  OpencodeXGoalEdgeTable,
  OpencodeXGoalNodeTable,
  OpencodeXGoalTable,
} from "@opencode-ai/core/opencodex/sql"
import { Identifier } from "@opencode-ai/core/util/identifier"
import { EventV2Bridge } from "@/event-v2-bridge"
import { and, eq, inArray, type SQL } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { encode, hydrateGoal } from "./goal-model"
import {
  NotFoundError,
  StateEvent,
  type Budget,
  type CreateInput,
  type EdgeInput,
  type Executor,
  type Info,
  type NodeInput,
  type NodeStatus,
  type Schedule,
  type Spend,
  type Status,
  type Verdict,
} from "./goal-schema"

/** Persistence for goals, their nodes, and their edges. */

export type NodePatch = {
  status?: NodeStatus
  title?: string
  brief?: string
  executor?: Executor
  jobID?: string | null
  sessionID?: string | null
  deliveredPrompt?: string | null
  result?: string | null
  verdict?: Verdict | null
  failureReason?: string | null
  attempt?: number
  iteration?: number
  loop?: { exitCheckNodeID: string; maxIterations: number; iteration: number; lastReport?: string }
  startedAt?: number | null
  completedAt?: number | null
}

export type GoalPatch = {
  status?: Status
  statusReason?: string | null
  title?: string
  successCriteria?: readonly string[]
  budget?: Budget
  schedule?: Schedule
  spend?: Spend
  metadata?: Record<string, unknown>
  startedAt?: number | null
  completedAt?: number | null
}

export function createGoalStore(db: Database.Interface["db"], events: EventV2.Interface) {
  const readGoals = Effect.fnUntraced(function* (where?: SQL) {
    const query = db.select().from(OpencodeXGoalTable)
    const goals = (yield* (where ? query.where(where) : query)
      .orderBy(OpencodeXGoalTable.time_updated)
      .all()
      .pipe(Effect.orDie)).toReversed()
    if (goals.length === 0) return []
    const ids = goals.map((goal) => goal.id)
    const [nodes, edges] = yield* Effect.all(
      [
        db
          .select()
          .from(OpencodeXGoalNodeTable)
          .where(inArray(OpencodeXGoalNodeTable.goal_id, ids))
          .orderBy(OpencodeXGoalNodeTable.goal_id, OpencodeXGoalNodeTable.sort_order)
          .all()
          .pipe(Effect.orDie),
        db
          .select()
          .from(OpencodeXGoalEdgeTable)
          .where(inArray(OpencodeXGoalEdgeTable.goal_id, ids))
          .all()
          .pipe(Effect.orDie),
      ],
      { concurrency: "unbounded" },
    )
    const nodesByGoal = Map.groupBy(nodes, (row) => row.goal_id)
    const edgesByGoal = Map.groupBy(edges, (row) => row.goal_id)
    return goals.map((goal) =>
      hydrateGoal({
        goal,
        nodes: nodesByGoal.get(goal.id) ?? [],
        edges: edgesByGoal.get(goal.id) ?? [],
      }),
    )
  })

  const list = Effect.fn("OpencodeXGoal.list")(function* (input?: { projectID?: string; sessionID?: string }) {
    const filters = [
      input?.projectID ? eq(OpencodeXGoalTable.opencodex_project_id, input.projectID) : undefined,
      input?.sessionID ? eq(OpencodeXGoalTable.owner_session_id, input.sessionID as never) : undefined,
    ].filter((filter): filter is SQL => filter !== undefined)
    return yield* readGoals(filters.length > 0 ? and(...filters) : undefined)
  })

  const get = Effect.fn("OpencodeXGoal.get")(function* (goalID: string) {
    const goals = yield* readGoals(eq(OpencodeXGoalTable.id, goalID))
    const goal = goals[0]
    if (!goal) return yield* new NotFoundError({ goalID })
    return goal
  })

  /** Every mutation lands in one transaction and broadcasts one update event. */
  const mutate = Effect.fnUntraced(function* <E, R>(
    goalID: string,
    body: (transaction: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Effect.Effect<void, E, R>,
    kind: "created" | "updated" = "updated",
  ) {
    const committed = yield* events.barrier(
      db
        .transaction(
          (transaction) =>
            Effect.gen(function* () {
              yield* body(transaction)
              yield* transaction
                .update(OpencodeXGoalTable)
                .set({ time_updated: Date.now() })
                .where(eq(OpencodeXGoalTable.id, goalID))
                .run()
              return yield* events.commit(kind === "created" ? StateEvent.Created : StateEvent.Updated, { goalID })
            }),
          { behavior: "immediate" },
        )
        .pipe(Effect.orDie),
    )
    yield* events.broadcast(committed)
    return yield* get(goalID)
  })

  const create = Effect.fn("OpencodeXGoal.create")(function* (input: CreateInput & { id?: string; title: string }) {
    const id = input.id ?? `oxg_${Identifier.ascending()}`
    const now = Date.now()
    const committed = yield* events.barrier(
      db
        .transaction(
          (transaction) =>
            Effect.gen(function* () {
              yield* transaction
                .insert(OpencodeXGoalTable)
                .values({
                  id,
                  opencodex_project_id: input.projectID,
                  title: input.title,
                  statement: input.statement,
                  success_criteria_json: [...(input.successCriteria ?? [])],
                  status: "draft",
                  source: input.source ?? "manual",
                  owner_session_id: (input.ownerSessionID ?? null) as never,
                  swarm_id: input.swarmID ?? null,
                  directory: input.directory ?? null,
                  budget_json: encode(input.budget),
                  spend_json: encode({ nodeRuns: 0, costUsd: 0 }),
                  schedule_json: encode(input.schedule),
                  metadata_json: encode(input.metadata),
                  time_created: now,
                  time_updated: now,
                })
                .run()
              return yield* events.commit(StateEvent.Created, { goalID: id })
            }),
          { behavior: "immediate" },
        )
        .pipe(Effect.orDie),
    )
    yield* events.broadcast(committed)
    return yield* get(id)
  })

  /** Replaces the plan wholesale. Only ever called before the goal runs. */
  const replacePlan = Effect.fn("OpencodeXGoal.replacePlan")(function* (input: {
    goalID: string
    nodes: readonly NodeInput[]
    edges: readonly EdgeInput[]
    successCriteria?: readonly string[]
    budget?: Budget
  }) {
    return yield* mutate(input.goalID, (transaction) =>
      Effect.gen(function* () {
        yield* transaction.delete(OpencodeXGoalEdgeTable).where(eq(OpencodeXGoalEdgeTable.goal_id, input.goalID)).run()
        yield* transaction.delete(OpencodeXGoalNodeTable).where(eq(OpencodeXGoalNodeTable.goal_id, input.goalID)).run()
        yield* insertNodes(transaction, input.goalID, input.nodes, 0)
        yield* insertEdges(transaction, input.goalID, input.edges)
        yield* transaction
          .update(OpencodeXGoalTable)
          .set({
            status: "planned",
            status_reason: null,
            ...(input.successCriteria ? { success_criteria_json: [...input.successCriteria] } : {}),
            ...(input.budget ? { budget_json: encode(input.budget) } : {}),
          })
          .where(eq(OpencodeXGoalTable.id, input.goalID))
          .run()
      }),
    )
  })

  /** Mid-flight repair. Additive: existing nodes are patched, never dropped. */
  const applyPlanUpdate = Effect.fn("OpencodeXGoal.applyPlanUpdate")(function* (input: {
    goalID: string
    addNodes: readonly NodeInput[]
    addEdges: readonly EdgeInput[]
    patchNodes: readonly { id: string; title?: string; brief?: string; executor?: Executor; status?: NodeStatus }[]
    successCriteria?: readonly string[]
    budget?: Budget
    sortOffset: number
  }) {
    return yield* mutate(input.goalID, (transaction) =>
      Effect.gen(function* () {
        yield* insertNodes(transaction, input.goalID, input.addNodes, input.sortOffset)
        yield* insertEdges(transaction, input.goalID, input.addEdges)
        yield* Effect.forEach(
          input.patchNodes,
          (patch) =>
            transaction
              .update(OpencodeXGoalNodeTable)
              .set({
                ...(patch.title !== undefined ? { title: patch.title } : {}),
                ...(patch.brief !== undefined ? { brief: patch.brief } : {}),
                ...(patch.executor !== undefined ? { executor_json: encode(patch.executor) } : {}),
                ...(patch.status !== undefined ? { status: patch.status } : {}),
                // Re-queueing a node means running it again from scratch: the
                // old job, session, and result belong to the previous attempt
                // and would otherwise be read as this one's.
                ...(patch.status === "planned"
                  ? {
                      job_id: null,
                      session_id: null,
                      delivered_prompt: null,
                      result_text: null,
                      verdict_json: null,
                      failure_reason: null,
                      started_at: null,
                      completed_at: null,
                    }
                  : {}),
                time_updated: Date.now(),
              })
              .where(
                and(
                  eq(OpencodeXGoalNodeTable.goal_id, input.goalID),
                  eq(OpencodeXGoalNodeTable.id, patch.id),
                ),
              )
              .run(),
          { concurrency: 1, discard: true },
        )
        if (input.successCriteria || input.budget) {
          yield* transaction
            .update(OpencodeXGoalTable)
            .set({
              ...(input.successCriteria ? { success_criteria_json: [...input.successCriteria] } : {}),
              ...(input.budget ? { budget_json: encode(input.budget) } : {}),
            })
            .where(eq(OpencodeXGoalTable.id, input.goalID))
            .run()
        }
      }),
    )
  })

  const patchNodes = Effect.fn("OpencodeXGoal.patchNodes")(function* (
    goalID: string,
    patches: readonly { nodeID: string; patch: NodePatch }[],
    goalPatch?: GoalPatch,
  ) {
    return yield* mutate(goalID, (transaction) =>
      Effect.gen(function* () {
        yield* Effect.forEach(
          patches,
          ({ nodeID, patch }) =>
            transaction
              .update(OpencodeXGoalNodeTable)
              .set({ ...nodeValues(patch), time_updated: Date.now() })
              .where(and(eq(OpencodeXGoalNodeTable.goal_id, goalID), eq(OpencodeXGoalNodeTable.id, nodeID)))
              .run(),
          { concurrency: 1, discard: true },
        )
        if (goalPatch) {
          yield* transaction
            .update(OpencodeXGoalTable)
            .set(goalValues(goalPatch))
            .where(eq(OpencodeXGoalTable.id, goalID))
            .run()
        }
      }),
    )
  })

  const patchGoal = Effect.fn("OpencodeXGoal.patchGoal")(function* (goalID: string, patch: GoalPatch) {
    return yield* mutate(goalID, (transaction) =>
      transaction.update(OpencodeXGoalTable).set(goalValues(patch)).where(eq(OpencodeXGoalTable.id, goalID)).run(),
    )
  })

  const remove = Effect.fn("OpencodeXGoal.remove")(function* (goalID: string) {
    yield* get(goalID)
    const committed = yield* events.barrier(
      db
        .transaction(
          (transaction) =>
            Effect.gen(function* () {
              yield* transaction.delete(OpencodeXGoalTable).where(eq(OpencodeXGoalTable.id, goalID)).run()
              return yield* events.commit(StateEvent.Deleted, { goalID })
            }),
          { behavior: "immediate" },
        )
        .pipe(Effect.orDie),
    )
    yield* events.broadcast(committed)
    return true
  })

  return { list, get, create, replacePlan, applyPlanUpdate, patchNodes, patchGoal, remove }
}

export type GoalStore = ReturnType<typeof createGoalStore>

/** One store shared by the service, the dispatcher, and the node executor. */
export class GoalStoreService extends Context.Service<GoalStoreService, GoalStore>()(
  "@opencode/OpencodeXGoalStore",
) {}

export const goalStoreLayer = Layer.effect(
  GoalStoreService,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const events = yield* EventV2Bridge.Service
    return GoalStoreService.of(createGoalStore(database.db, events))
  }),
)

type Transaction = Parameters<Parameters<Database.Interface["db"]["transaction"]>[0]>[0]

function insertNodes(
  transaction: Transaction,
  goalID: string,
  nodes: readonly NodeInput[],
  sortOffset: number,
): Effect.Effect<void, never, never> {
  if (nodes.length === 0) return Effect.void
  const now = Date.now()
  return Effect.forEach(
    nodes,
    (node, index) =>
      transaction
        .insert(OpencodeXGoalNodeTable)
        .values({
          id: node.id,
          goal_id: goalID,
          kind: node.kind ?? "task",
          title: node.title,
          brief: node.brief,
          status: "planned",
          executor_json: encode(node.executor),
          parent_node_id: node.parentNodeID ?? null,
          loop_json: node.loop
            ? encode({
                exitCheckNodeID: node.loop.exitCheckNodeID,
                maxIterations: node.loop.maxIterations ?? 3,
                iteration: 0,
              })
            : undefined,
          sort_order: sortOffset + index,
          iteration: 0,
          attempt: 0,
          metadata_json: encode(node.metadata),
          time_created: now,
          time_updated: now,
        })
        .run(),
    { concurrency: 1, discard: true },
  ).pipe(Effect.orDie)
}

function insertEdges(
  transaction: Transaction,
  goalID: string,
  edges: readonly EdgeInput[],
): Effect.Effect<void, never, never> {
  if (edges.length === 0) return Effect.void
  const now = Date.now()
  return Effect.forEach(
    edges,
    (edge) =>
      transaction
        .insert(OpencodeXGoalEdgeTable)
        .values({
          goal_id: goalID,
          from_node_id: edge.from,
          to_node_id: edge.to,
          kind: edge.kind ?? "requires",
          time_created: now,
          time_updated: now,
        })
        .onConflictDoNothing()
        .run(),
    { concurrency: 1, discard: true },
  ).pipe(Effect.orDie)
}

function nodeValues(patch: NodePatch) {
  return {
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.brief !== undefined ? { brief: patch.brief } : {}),
    ...(patch.executor !== undefined ? { executor_json: encode(patch.executor) } : {}),
    ...(patch.jobID !== undefined ? { job_id: patch.jobID } : {}),
    ...(patch.sessionID !== undefined ? { session_id: patch.sessionID as never } : {}),
    ...(patch.deliveredPrompt !== undefined ? { delivered_prompt: patch.deliveredPrompt } : {}),
    ...(patch.result !== undefined ? { result_text: patch.result } : {}),
    ...(patch.verdict !== undefined ? { verdict_json: patch.verdict === null ? null : encode(patch.verdict) } : {}),
    ...(patch.failureReason !== undefined ? { failure_reason: patch.failureReason } : {}),
    ...(patch.attempt !== undefined ? { attempt: patch.attempt } : {}),
    ...(patch.iteration !== undefined ? { iteration: patch.iteration } : {}),
    ...(patch.loop !== undefined ? { loop_json: encode(patch.loop) } : {}),
    ...(patch.startedAt !== undefined ? { started_at: patch.startedAt } : {}),
    ...(patch.completedAt !== undefined ? { completed_at: patch.completedAt } : {}),
  }
}

function goalValues(patch: GoalPatch) {
  return {
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.statusReason !== undefined ? { status_reason: patch.statusReason } : {}),
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.successCriteria !== undefined ? { success_criteria_json: [...patch.successCriteria] } : {}),
    ...(patch.budget !== undefined ? { budget_json: encode(patch.budget) } : {}),
    ...(patch.schedule !== undefined ? { schedule_json: encode(patch.schedule) } : {}),
    ...(patch.spend !== undefined ? { spend_json: encode(patch.spend) } : {}),
    ...(patch.metadata !== undefined ? { metadata_json: encode(patch.metadata) } : {}),
    ...(patch.startedAt !== undefined ? { started_at: patch.startedAt } : {}),
    ...(patch.completedAt !== undefined ? { completed_at: patch.completedAt } : {}),
    time_updated: Date.now(),
  }
}
