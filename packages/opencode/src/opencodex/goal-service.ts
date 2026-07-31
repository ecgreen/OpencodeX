import { Database } from "@opencode-ai/core/database/database"
import { OpencodeXSwarmRoleTable } from "@opencode-ai/core/opencodex/sql"
import { OpencodeXJob } from "@/opencodex/job"
import { OpencodeXProject } from "@/opencodex/project"
import { asc, eq } from "drizzle-orm"
import { Effect, Layer } from "effect"
import { GoalDispatch } from "./goal-dispatch"
import { validatePlan } from "./goal-graph"
import { GoalStoreService } from "./goal-store"
import {
  NodeNotFoundError,
  Service,
  ValidationError,
  type CreateInput,
  type EdgeInput,
  type Info,
  type Node,
  type NodeInput,
  type PlanInput,
  type UpdatePlanInput,
} from "./goal-schema"

/** The goal API: create, plan, repair, approve, cancel. */

export const goalServiceLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const store = yield* GoalStoreService
    const projects = yield* OpencodeXProject.Service
    const jobs = yield* OpencodeXJob.Service
    const dispatch = yield* GoalDispatch

    /**
     * Role names a planner may legally use. Agent names are deliberately not
     * checked here: resolving them needs the agent registry, which is built
     * inside the prompt loop that the graph tools themselves live in. An
     * unknown agent fails loudly at dispatch instead.
     */
    const executorNames = Effect.fnUntraced(function* (swarmID?: string) {
      if (!swarmID) return {}
      const roles = yield* db
        .select({ name: OpencodeXSwarmRoleTable.name })
        .from(OpencodeXSwarmRoleTable)
        .where(eq(OpencodeXSwarmRoleTable.swarm_id, swarmID))
        .orderBy(asc(OpencodeXSwarmRoleTable.sort_order))
        .all()
        .pipe(Effect.orElseSucceed(() => []))
      // The orchestrator leads the conversation; specialists do the nodes.
      return roles.length > 0 ? { roles: roles.slice(1).map((role) => role.name) } : {}
    })

    const create = Effect.fn("OpencodeXGoal.create")(function* (input: CreateInput) {
      if (!input.statement.trim()) {
        return yield* new ValidationError({ message: "A goal needs a statement of what you want." })
      }
      yield* projects.get(input.projectID)
      return yield* store
        .create({ ...input, title: input.title?.trim() || deriveTitle(input.statement) })
        // The store re-reads the row it just inserted; a miss is corruption.
        .pipe(Effect.orDie)
    })

    const plan = Effect.fn("OpencodeXGoal.plan")(function* (goalID: string, input: PlanInput) {
      const goal = yield* store.get(goalID)
      if (goal.status !== "draft" && goal.status !== "planned") {
        return yield* new ValidationError({
          message: `This goal is ${goal.status}; use graph_update to change a plan that is already running.`,
        })
      }
      const context = yield* executorNames(goal.swarmID)
      const edges = input.edges ?? []
      const issues = validatePlan({ nodes: input.nodes, edges }, context)
      if (issues.length > 0) {
        return yield* new ValidationError({ message: `This plan cannot run: ${issues[0]}`, issues })
      }
      return yield* store.replacePlan({
        goalID,
        nodes: input.nodes,
        edges,
        successCriteria: input.successCriteria,
        budget: input.budget,
      })
    })

    const updatePlan = Effect.fn("OpencodeXGoal.updatePlan")(function* (goalID: string, input: UpdatePlanInput) {
      const goal = yield* store.get(goalID)
      const addNodes = input.addNodes ?? []
      const addEdges = input.addEdges ?? []
      const patches = input.patchNodes ?? []
      const unknown = patches.find((patch) => !goal.nodes.some((node) => node.id === patch.id))
      if (unknown) {
        return yield* new ValidationError({ message: `This plan has no node "${unknown.id}".` })
      }
      // The whole graph is revalidated, not just the additions: a remediation
      // node that introduces a cycle is exactly the case worth catching.
      const merged = mergePlan(goal, addNodes, patches)
      const context = yield* executorNames(goal.swarmID)
      const issues = validatePlan({ nodes: merged, edges: [...existingEdges(goal), ...addEdges] }, context)
      if (issues.length > 0) {
        return yield* new ValidationError({ message: `This change cannot run: ${issues[0]}`, issues })
      }
      const updated = yield* store.applyPlanUpdate({
        goalID,
        addNodes,
        addEdges,
        patchNodes: patches,
        successCriteria: input.successCriteria,
        budget: input.budget,
        sortOffset: goal.nodes.length,
      })
      // Adding work to a goal that had settled means it is not settled any
      // more. Without this the repair would sit there, since the dispatcher
      // leaves terminal goals alone.
      if (updated.status === "completed" || updated.status === "failed") {
        if (updated.nodes.some((node) => node.status === "planned")) {
          yield* store.patchGoal(goalID, { status: "running", statusReason: null, completedAt: null })
        }
      }
      yield* dispatch.reconcile(goalID)
      return yield* store.get(updated.id)
    })

    const report = Effect.fn("OpencodeXGoal.report")(function* (
      goalID: string,
      input: { nodeID: string; result?: string; verdict?: Info["nodes"][number]["verdict"] },
    ) {
      const goal = yield* store.get(goalID)
      if (!goal.nodes.some((node) => node.id === input.nodeID)) {
        return yield* new NodeNotFoundError({ goalID, nodeID: input.nodeID })
      }
      return yield* store.patchNodes(goalID, [
        {
          nodeID: input.nodeID,
          patch: {
            ...(input.result !== undefined ? { result: input.result } : {}),
            ...(input.verdict !== undefined ? { verdict: input.verdict } : {}),
          },
        },
      ])
    })

    const start = Effect.fn("OpencodeXGoal.start")(function* (goalID: string) {
      const goal = yield* store.get(goalID)
      if (goal.nodes.length === 0) {
        return yield* new ValidationError({ message: "This goal has no plan yet; author one with graph_plan." })
      }
      if (goal.status === "draft" || goal.status === "planned" || goal.status === "paused") {
        yield* store.patchGoal(goalID, {
          status: "running",
          statusReason: null,
          ...(goal.startedAt ? {} : { startedAt: Date.now() }),
        })
      }
      yield* dispatch.reconcile(goalID)
      return yield* store.get(goalID)
    })

    const approve = Effect.fn("OpencodeXGoal.approve")(function* (goalID: string, nodeID: string, approved: boolean) {
      const goal = yield* store.get(goalID)
      const node = goal.nodes.find((item) => item.id === nodeID)
      if (!node) return yield* new NodeNotFoundError({ goalID, nodeID })
      yield* store.patchNodes(goalID, [
        {
          nodeID,
          patch: {
            status: approved ? "done" : "skipped",
            completedAt: Date.now(),
            result: approved ? "Approved." : undefined,
            ...(approved ? {} : { failureReason: "Not approved." }),
          },
        },
      ])
      yield* dispatch.reconcile(goalID)
      return yield* store.get(goalID)
    })

    const cancel = Effect.fn("OpencodeXGoal.cancel")(function* (goalID: string) {
      const goal = yield* store.get(goalID)
      const live = goal.nodes.flatMap((node) =>
        node.jobID && ["dispatched", "running"].includes(node.status) ? [node.jobID] : [],
      )
      yield* Effect.forEach(live, (jobID) => jobs.cancel(jobID).pipe(Effect.ignore), { concurrency: 1, discard: true })
      yield* store.patchNodes(
        goalID,
        goal.nodes
          .filter((node) => !["done", "failed", "skipped", "cancelled"].includes(node.status))
          .map((node) => ({ nodeID: node.id, patch: { status: "cancelled" as const, completedAt: Date.now() } })),
        { status: "cancelled", completedAt: Date.now(), statusReason: "Cancelled." },
      )
      return yield* store.get(goalID)
    })

    const remove = Effect.fn("OpencodeXGoal.remove")(function* (goalID: string) {
      yield* cancel(goalID).pipe(Effect.ignore)
      return yield* store.remove(goalID)
    })

    return Service.of({
      list: store.list,
      get: store.get,
      create,
      plan,
      updatePlan,
      report,
      start,
      approve,
      cancel,
      remove,
    })
  }),
)

/** A goal's own title, when the user did not write one. */
export function deriveTitle(statement: string) {
  const line = statement.split("\n").find((value) => value.trim())?.trim() ?? statement.trim()
  return line.length > 60 ? `${line.slice(0, 60)}...` : line || "Goal"
}

/** Existing nodes in the shape validation speaks, so a change is checked whole. */
function mergePlan(
  goal: Info,
  addNodes: readonly NodeInput[],
  patches: readonly { id: string; title?: string; brief?: string; executor?: NodeInput["executor"] }[],
): NodeInput[] {
  const patchByID = new Map(patches.map((patch) => [patch.id, patch]))
  const existing = goal.nodes.map((node): NodeInput => {
    const patch = patchByID.get(node.id)
    return {
      id: node.id,
      kind: node.kind,
      title: patch?.title ?? node.title,
      brief: patch?.brief ?? node.brief,
      executor: patch?.executor ?? node.executor,
      ...(node.parentNodeID ? { parentNodeID: node.parentNodeID } : {}),
      ...(node.loop
        ? { loop: { exitCheckNodeID: node.loop.exitCheckNodeID, maxIterations: node.loop.maxIterations } }
        : {}),
    }
  })
  return [...existing, ...addNodes]
}

function existingEdges(goal: Info): EdgeInput[] {
  return goal.edges.map((edge) => ({ from: edge.fromNodeID, to: edge.toNodeID, kind: edge.kind }))
}

/** Nodes as the planner shaped them, for callers that re-present a plan. */
export function nodeToInput(node: Node): NodeInput {
  return {
    id: node.id,
    kind: node.kind,
    title: node.title,
    brief: node.brief,
    executor: node.executor,
    ...(node.parentNodeID ? { parentNodeID: node.parentNodeID } : {}),
    ...(node.loop
      ? { loop: { exitCheckNodeID: node.loop.exitCheckNodeID, maxIterations: node.loop.maxIterations } }
      : {}),
  }
}
