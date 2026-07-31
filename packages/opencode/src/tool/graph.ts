import { OpencodeXGoal } from "@/opencodex/goal"
import { OpencodeXProject } from "@/opencodex/project"
import { Effect, Schema } from "effect"
import { Tool } from "./tool"
import {
  describeGoal,
  goalOutcome,
  resolveExecutorParam,
  type ExecutorParam,
} from "./graph-report"

/**
 * The planner's tools. A model authors a task graph for a goal, the dispatcher
 * walks it, and the planner gets every node's report back - so "delegate this
 * yourself, one call at a time" becomes "state the shape of the work once".
 */

const Executor = Schema.Struct({
  role: Schema.optional(Schema.String).annotate({
    description: "Swarm role name, when this session runs on a swarm. Takes precedence over agent.",
  }),
  agent: Schema.optional(Schema.String).annotate({ description: "Agent name to run this node as" }),
  providerID: Schema.optional(Schema.String).annotate({ description: "Provider id; defaults to this session's model" }),
  modelID: Schema.optional(Schema.String).annotate({ description: "Model id; defaults to this session's model" }),
  skill: Schema.optional(Schema.String).annotate({ description: "Skill whose body is prefixed to the node's prompt" }),
  instructions: Schema.optional(Schema.String).annotate({
    description: "Standing instructions for this executor, applied ahead of the node's brief",
  }),
})

const NodeParam = Schema.Struct({
  id: Schema.String.annotate({ description: "Short id you choose, referenced by edges. Letters, digits, dot, dash." }),
  title: Schema.String.annotate({ description: "Short human-readable name" }),
  brief: Schema.String.annotate({
    description:
      "Self-contained instructions for this node. The executor sees the goal, this brief, and piped-in results - never this conversation.",
  }),
  kind: Schema.optional(Schema.Literals(["task", "check", "loop", "synthesis", "gate"])).annotate({
    description:
      "task (default): does work. check: verifies and returns a pass/fail verdict. loop: repeats its body until its exit check passes. synthesis: reconciles results. gate: waits for human approval.",
  }),
  executor: Schema.optional(Executor).annotate({ description: "Who runs it. Required except on loop and gate nodes." }),
  parentNodeID: Schema.optional(Schema.String).annotate({ description: "The loop node this node is a body member of" }),
  loop: Schema.optional(
    Schema.Struct({
      exitCheckNodeID: Schema.String.annotate({
        description: "Id of the check node, inside this loop's body, whose verdict ends the loop",
      }),
      maxIterations: Schema.optional(Schema.Number).annotate({ description: "Iteration cap, default 3" }),
    }),
  ).annotate({ description: "Required on loop nodes" }),
})

const EdgeParam = Schema.Struct({
  from: Schema.String,
  to: Schema.String,
  kind: Schema.optional(Schema.Literals(["requires", "feeds"])).annotate({
    description:
      "requires (default): wait for the upstream node. feeds: also paste the upstream node's result into this node's prompt.",
  }),
})

const Budget = Schema.Struct({
  maxNodeRuns: Schema.optional(Schema.Number).annotate({ description: "Stop dispatching after this many node runs" }),
  maxWallClockMs: Schema.optional(Schema.Number),
  maxCostUsd: Schema.optional(Schema.Number),
})

export const PlanParameters = Schema.Struct({
  goal: Schema.String.annotate({ description: "What outcome the graph achieves, in one or two sentences" }),
  successCriteria: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "Checkable claims that mean the goal is met, for example \"bun test passes\"",
  }),
  nodes: Schema.mutable(Schema.Array(NodeParam)).annotate({ description: "The units of work" }),
  edges: Schema.optional(Schema.mutable(Schema.Array(EdgeParam))).annotate({
    description: "Dependencies. Nodes with no edge between them run at the same time.",
  }),
  budget: Schema.optional(Budget),
  wait: Schema.optional(Schema.Boolean).annotate({
    description: "Default true: block until the graph finishes and return every node's report.",
  }),
})

type PlanMetadata = { goalID?: string; nodeCount?: number; status?: string }

export const GraphPlanTool = Tool.define<typeof PlanParameters, PlanMetadata, OpencodeXGoal.Service | OpencodeXProject.Service>(
  "graph_plan",
  Effect.gen(function* () {
    const goals = yield* OpencodeXGoal.Service
    const projects = yield* OpencodeXProject.Service

    return {
      description: [
        "Plan a goal as a task graph and let OpenCodeX run it.",
        "Use this for work with several parts: the nodes you declare are delegated automatically, independent nodes run in parallel, and loops repeat until their check passes.",
        "Prefer this over delegating one specialist at a time - you state the shape of the work once and get every report back.",
        "Skip it for a single question or a one-step edit.",
      ].join("\n"),
      parameters: PlanParameters,
      execute: (params: Schema.Schema.Type<typeof PlanParameters>, ctx: Tool.Context<PlanMetadata>) =>
        Effect.gen(function* () {
          yield* ctx.ask({ permission: "graph_plan", patterns: ["*"], always: ["*"], metadata: {} })
          const project = yield* projectForSession(projects, ctx.sessionID)
          if (!project) {
            return {
              title: "No project",
              output: "This session does not belong to an OpenCodeX project, so it cannot own a goal.",
              metadata: {},
            }
          }
          const model = ctx.extra?.model as { providerID?: string; modelID?: string } | undefined
          const existing = (yield* goals.list({ sessionID: ctx.sessionID })).find(
            (goal) => !OpencodeXGoal.TERMINAL_STATUSES.includes(goal.status),
          )
          const goal =
            existing ??
            (yield* goals
              .create({
                projectID: project.id,
                statement: params.goal,
                successCriteria: params.successCriteria,
                ownerSessionID: ctx.sessionID,
                ...(model?.providerID === "swarm" && model.modelID ? { swarmID: model.modelID } : {}),
                source: "manual",
                budget: params.budget,
                metadata: { createdByTool: "graph_plan", agent: ctx.agent },
              })
              .pipe(Effect.catchTag("Project.NotFoundError", (error) => Effect.die(error))))

          const planned = yield* attempt(
            goals
              .plan(goal.id, {
                nodes: params.nodes.map(toNodeInput),
                edges: (params.edges ?? []).map((edge) => ({ from: edge.from, to: edge.to, kind: edge.kind })),
                successCriteria: params.successCriteria,
                budget: params.budget,
              })
              .pipe(Effect.catchTag("OpencodeX.Goal.NotFoundError", Effect.die)),
          )
          if (!planned.ok) {
            return {
              title: "Plan rejected",
              output: rejection("This plan cannot run. Fix these and call graph_plan again:", planned.error),
              metadata: { goalID: goal.id },
            }
          }

          const started = yield* goals.start(planned.value.id).pipe(Effect.orElseSucceed(() => planned.value))
          if (params.wait === false) {
            return {
              title: `Running: ${started.title}`,
              output: describeGoal(started, { includeResults: false }),
              metadata: { goalID: started.id, nodeCount: started.nodes.length, status: started.status },
            }
          }
          const settled = yield* awaitGoal(goals, started.id, ctx.abort)
          return {
            title: `${goalOutcome(settled)}: ${settled.title}`,
            output: describeGoal(settled, { includeResults: true }),
            metadata: { goalID: settled.id, nodeCount: settled.nodes.length, status: settled.status },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof PlanParameters, PlanMetadata>
  }),
)

export const UpdateParameters = Schema.Struct({
  addNodes: Schema.optional(Schema.mutable(Schema.Array(NodeParam))).annotate({
    description: "New nodes, for example remediation for something a check found",
  }),
  addEdges: Schema.optional(Schema.mutable(Schema.Array(EdgeParam))),
  patchNodes: Schema.optional(
    Schema.mutable(
      Schema.Array(
        Schema.Struct({
          id: Schema.String,
          title: Schema.optional(Schema.String),
          brief: Schema.optional(Schema.String),
          executor: Schema.optional(Executor),
          status: Schema.optional(Schema.Literals(["planned", "skipped"])).annotate({
            description: "skipped abandons a node that is no longer needed; planned re-queues one you skipped.",
          }),
        }),
      ),
    ),
  ),
  successCriteria: Schema.optional(Schema.Array(Schema.String)),
  budget: Schema.optional(Budget),
  wait: Schema.optional(Schema.Boolean).annotate({ description: "Default true: block until the graph finishes." }),
})

type UpdateMetadata = { goalID?: string; status?: string }

export const GraphUpdateTool = Tool.define<typeof UpdateParameters, UpdateMetadata, OpencodeXGoal.Service>(
  "graph_update",
  Effect.gen(function* () {
    const goals = yield* OpencodeXGoal.Service

    return {
      description: [
        "Repair the graph: add remediation nodes, skip work that is no longer needed, re-queue a node with status \"planned\", or retarget a node's executor.",
        "Use this instead of re-planning when the goal is already running - existing nodes and their results are kept.",
        "Works on a finished goal too: adding or re-queueing work reopens it, which is how you remediate a failure.",
      ].join("\n"),
      parameters: UpdateParameters,
      execute: (params: Schema.Schema.Type<typeof UpdateParameters>, ctx: Tool.Context<UpdateMetadata>) =>
        Effect.gen(function* () {
          yield* ctx.ask({ permission: "graph_update", patterns: ["*"], always: ["*"], metadata: {} })
          const all = yield* goals.list({ sessionID: ctx.sessionID })
          // Prefer the live goal, else the most recent settled one: a failed
          // goal is exactly the one a planner needs to repair and reopen.
          const goal = all.find((item) => !OpencodeXGoal.TERMINAL_STATUSES.includes(item.status)) ?? all[0]
          if (!goal) {
            return { title: "No goal", output: "This session has no goal to update.", metadata: {} }
          }
          const updated = yield* attempt(
            goals
              .updatePlan(goal.id, {
                addNodes: params.addNodes?.map(toNodeInput),
                addEdges: params.addEdges?.map((edge) => ({ from: edge.from, to: edge.to, kind: edge.kind })),
                patchNodes: params.patchNodes?.map((patch) => ({
                  id: patch.id,
                  title: patch.title,
                  brief: patch.brief,
                  status: patch.status,
                  executor: patch.executor ? resolveExecutorParam(patch.executor) : undefined,
                })),
                successCriteria: params.successCriteria,
                budget: params.budget,
              })
              .pipe(Effect.catchTag("OpencodeX.Goal.NotFoundError", Effect.die)),
          )
          if (!updated.ok) {
            return {
              title: "Change rejected",
              output: rejection("This change cannot run. Fix these and try again:", updated.error),
              metadata: { goalID: goal.id },
            }
          }
          const settled =
            params.wait === false ? updated.value : yield* awaitGoal(goals, updated.value.id, ctx.abort)
          return {
            title: `${goalOutcome(settled)}: ${settled.title}`,
            output: describeGoal(settled, { includeResults: params.wait !== false }),
            metadata: { goalID: settled.id, status: settled.status },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof UpdateParameters, UpdateMetadata>
  }),
)

export const StatusParameters = Schema.Struct({
  nodeID: Schema.optional(Schema.String).annotate({
    description: "Report just this node, including the full text it was given and produced",
  }),
})

type StatusMetadata = { goalID?: string; status?: string }

export const GraphStatusTool = Tool.define<typeof StatusParameters, StatusMetadata, OpencodeXGoal.Service>(
  "graph_status",
  Effect.gen(function* () {
    const goals = yield* OpencodeXGoal.Service

    return {
      description: "Show this session's goal graph: every node's status, and the reports finished nodes produced.",
      parameters: StatusParameters,
      execute: (params: Schema.Schema.Type<typeof StatusParameters>, ctx: Tool.Context<StatusMetadata>) =>
        Effect.gen(function* () {
          const all = yield* goals.list({ sessionID: ctx.sessionID })
          const goal = all.find((item) => !OpencodeXGoal.TERMINAL_STATUSES.includes(item.status)) ?? all[0]
          if (!goal) return { title: "No goal", output: "This session has no goal.", metadata: {} }
          if (params.nodeID) {
            const node = goal.nodes.find((item) => item.id === params.nodeID)
            if (!node) {
              return {
                title: "Unknown node",
                output: `This goal has no node "${params.nodeID}". Nodes: ${goal.nodes.map((item) => item.id).join(", ")}.`,
                metadata: { goalID: goal.id },
              }
            }
            return {
              title: `${node.title} (${node.status})`,
              output: [
                `# ${node.title} [${node.id}] - ${node.status}`,
                ...(node.sessionID ? [`Session: ${node.sessionID}`] : []),
                ...(node.deliveredPrompt ? ["", "## Prompt delivered", node.deliveredPrompt] : []),
                ...(node.result ? ["", "## Report", node.result] : []),
                ...(node.failureReason ? ["", "## Failure", node.failureReason] : []),
              ].join("\n"),
              metadata: { goalID: goal.id, status: goal.status },
            }
          }
          return {
            title: `${goal.title} (${goal.status})`,
            output: describeGoal(goal, { includeResults: true }),
            metadata: { goalID: goal.id, status: goal.status },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof StatusParameters, StatusMetadata>
  }),
)

/**
 * A rejected plan is a normal outcome for a planner, not a tool failure: the
 * model gets the issues back and repairs them. This keeps that path typed.
 */
function attempt<A, R>(effect: Effect.Effect<A, OpencodeXGoal.ValidationError, R>) {
  return effect.pipe(
    Effect.map((value) => ({ ok: true as const, value })),
    Effect.catchTag("OpencodeX.Goal.ValidationError", (error) => Effect.succeed({ ok: false as const, error })),
  )
}

function rejection(headline: string, error: OpencodeXGoal.ValidationError) {
  const issues = error.issues ?? [error.message]
  return [headline, ...issues.map((issue) => `- ${issue}`)].join("\n")
}

function toNodeInput(node: Schema.Schema.Type<typeof NodeParam>) {
  return {
    id: node.id,
    kind: node.kind,
    title: node.title,
    brief: node.brief,
    executor: node.executor ? resolveExecutorParam(node.executor) : undefined,
    parentNodeID: node.parentNodeID,
    loop: node.loop,
  }
}

function projectForSession(projects: OpencodeXProject.Interface, sessionID: string) {
  return projects
    .list()
    .pipe(Effect.map((all) => all.find((project) => project.sessions.some((session) => session.id === sessionID))))
}

/** Polls until the goal settles. The graph runs in jobs, not in this fiber. */
function awaitGoal(goals: OpencodeXGoal.Interface, goalID: string, abort: AbortSignal) {
  return Effect.gen(function* () {
    while (true) {
      const goal = yield* goals.get(goalID).pipe(Effect.catchTag("OpencodeX.Goal.NotFoundError", Effect.die))
      if (OpencodeXGoal.TERMINAL_STATUSES.includes(goal.status)) return goal
      // A paused goal is waiting on a human decision, not on more work; a
      // blocked one is parked at a gate. Neither resolves without the user -
      // but parallel branches may still be landing, and their reports belong
      // in the reply, so return only once nothing is in flight.
      const busy = goal.nodes.some((node) => node.status === "dispatched" || node.status === "running")
      if ((goal.status === "paused" || goal.status === "blocked") && !busy) return goal
      if (abort.aborted) return goal
      yield* Effect.sleep(1_000)
    }
  })
}

export type { ExecutorParam }
