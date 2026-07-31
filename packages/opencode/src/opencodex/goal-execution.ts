import { Database } from "@opencode-ai/core/database/database"
import { OpencodeXProjectFolderTable, OpencodeXSwarmRoleTable } from "@opencode-ai/core/opencodex/sql"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { InstanceStore } from "@/project/instance-store"
import { OpencodeXJob } from "@/opencodex/job"
import { Provider } from "@/provider/provider"
import { Session } from "@/session/session"
import { SessionID } from "@/session/schema"
import { SessionPrompt } from "@/session/prompt"
import { Skill } from "@/skill"
import { ToolJsonSchema } from "@/tool/json-schema"
import { asc, eq } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { feedsContext } from "./goal-graph"
import { resolveExecutor } from "./goal-executor"
import { buildNodePrompt } from "./goal-prompt"
import { GoalStoreService } from "./goal-store"
import { Verdict, type Info, type Node } from "./goal-schema"

/**
 * Running one graph node: resolve its executor, assemble and persist the exact
 * prompt, run it as a child session, and record what came back. Every node -
 * swarm role, agent, or bare model - takes this one path.
 */

const VERDICT_SCHEMA = ToolJsonSchema.fromSchema(Verdict)

export type NodeResult = {
  nodeID: string
  sessionID: string
  costUsd: number
  passed?: boolean
}

export interface Interface {
  readonly executeNode: (
    job: OpencodeXJob.Info,
    signal: AbortSignal,
  ) => Effect.Effect<Record<string, unknown>, unknown>
}

export class GoalExecution extends Context.Service<GoalExecution, Interface>()("@opencode/OpencodeXGoalExecution") {}

export const goalExecutionLayer = Layer.effect(
  GoalExecution,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const store = yield* GoalStoreService
    const instances = yield* InstanceStore.Service
    const sessions = yield* Session.Service
    const prompt = yield* SessionPrompt.Service
    const skills = yield* Skill.Service
    const provider = yield* Provider.Service
    const jobs = yield* OpencodeXJob.Service

    /** The model a node inherits when its executor does not name one. */
    const fallbackModel = Effect.fnUntraced(function* (goal: Info) {
      if (goal.ownerSessionID) {
        const session = yield* sessions.get(SessionID.make(goal.ownerSessionID)).pipe(Effect.option)
        const model = session._tag === "Some" ? session.value.model : undefined
        // A swarm-model session routes to the orchestrator, so it is never a
        // usable fallback for a node - the swarm roles carry the real models.
        if (model?.providerID && model.id && model.providerID !== "swarm") {
          return { providerID: model.providerID, modelID: model.id }
        }
      }
      const fallback = yield* provider.defaultModel().pipe(Effect.option)
      if (fallback._tag === "None") return undefined
      return { providerID: fallback.value.providerID, modelID: fallback.value.modelID }
    })

    const projectDirectory = Effect.fnUntraced(function* (projectID: string) {
      const row = yield* db
        .select({ path: OpencodeXProjectFolderTable.path })
        .from(OpencodeXProjectFolderTable)
        .where(eq(OpencodeXProjectFolderTable.opencodex_project_id, projectID))
        .get()
        .pipe(Effect.orElseSucceed(() => undefined))
      return row?.path
    })

    const swarmRoles = Effect.fnUntraced(function* (swarmID: string | undefined) {
      if (!swarmID) return []
      return yield* db
        .select({
          name: OpencodeXSwarmRoleTable.name,
          agent: OpencodeXSwarmRoleTable.agent,
          skill: OpencodeXSwarmRoleTable.skill,
          instructions: OpencodeXSwarmRoleTable.instructions,
          provider_id: OpencodeXSwarmRoleTable.provider_id,
          model_id: OpencodeXSwarmRoleTable.model_id,
        })
        .from(OpencodeXSwarmRoleTable)
        .where(eq(OpencodeXSwarmRoleTable.swarm_id, swarmID))
        .orderBy(asc(OpencodeXSwarmRoleTable.sort_order))
        .all()
        .pipe(Effect.orElseSucceed(() => []))
    })

    /** Where a loop body node learns what the last pass got wrong. */
    function iterationContext(goal: Info, node: Node) {
      if (!node.parentNodeID) return undefined
      const loop = goal.nodes.find((item) => item.id === node.parentNodeID)?.loop
      if (!loop?.lastReport || loop.iteration < 2) return undefined
      return { number: loop.iteration, maxIterations: loop.maxIterations, report: loop.lastReport }
    }

    const executeNode = Effect.fn("OpencodeXGoal.executeNode")(function* (
      job: OpencodeXJob.Info,
      signal: AbortSignal,
    ) {
      const goalID = typeof job.metadata?.goalID === "string" ? job.metadata.goalID : undefined
      const nodeID = typeof job.metadata?.nodeID === "string" ? job.metadata.nodeID : undefined
      if (!goalID || !nodeID) return yield* Effect.fail(new Error(`Goal job ${job.id} names no node`))
      const goal = yield* store.get(goalID).pipe(Effect.orDie)
      const node = goal.nodes.find((item) => item.id === nodeID)
      if (!node) return yield* Effect.fail(new Error(`Goal ${goalID} has no node ${nodeID}`))

      // Read the directory straight from the folder table: resolving it
      // through the project service would need an instance, and the instance
      // is the thing the directory selects.
      const directory = goal.directory ?? (yield* projectDirectory(goal.projectID))
      if (!directory) return yield* Effect.fail(new Error(`Goal ${goalID} has no directory to run in`))

      // Everything from here needs an instance: resolving a default model,
      // reading the owner session, and creating the child all run against the
      // directory the goal belongs to.
      return yield* instances.provide(
        { directory },
        Effect.gen(function* () {
          const [roles, fallback] = yield* Effect.all([swarmRoles(goal.swarmID), fallbackModel(goal)], {
            concurrency: "unbounded",
          })
          const resolved = resolveExecutor({ executor: node.executor, kind: node.kind, roles, fallback })
          if ("error" in resolved) return yield* Effect.fail(new Error(resolved.error))
          const executor = resolved.executor

          const skill = executor.skill
            ? yield* skills.get(executor.skill).pipe(Effect.orElseSucceed(() => undefined))
            : undefined
          const text = buildNodePrompt({
            skill: skill?.content,
            instructions: executor.instructions,
            goal: { statement: goal.statement, successCriteria: goal.successCriteria },
            node: { kind: node.kind, title: node.title, brief: node.brief },
            context: feedsContext(goal, node.id),
            iteration: iterationContext(goal, node),
          })
          const owner = goal.ownerSessionID
            ? yield* sessions.get(SessionID.make(goal.ownerSessionID)).pipe(Effect.option)
            : undefined
          const parent = owner?._tag === "Some" ? owner.value : undefined
          const child = yield* sessions
            .create({
              // Node sessions are children of the goal's chat session, so every
              // session list keeps showing exactly one session per goal.
              ...(parent ? { parentID: parent.id } : {}),
              title: `${node.title} (${executor.label})`,
              metadata: {
                opencodex: {
                  goalID: goal.id,
                  goalNodeID: node.id,
                  ...(goal.swarmID ? { swarmID: goal.swarmID } : {}),
                  ...(executor.roleName ? { swarmRole: executor.roleName } : {}),
                },
              },
              ...(parent?.permission ? { permission: parent.permission } : {}),
            })
            .pipe(Effect.orDie)

          // Persisted before the turn starts: if anything goes wrong from here,
          // "what did this node receive" is still answerable.
          yield* store
            .patchNodes(goal.id, [
              {
                nodeID: node.id,
                patch: {
                  status: "running",
                  sessionID: child.id,
                  deliveredPrompt: text,
                  jobID: job.id,
                  attempt: job.attempt,
                  startedAt: Date.now(),
                  result: null,
                  verdict: null,
                  failureReason: null,
                },
              },
            ])
            .pipe(Effect.orDie)
          yield* jobs.update({ id: job.id, sessionID: child.id }).pipe(Effect.ignore)

          const result = yield* prompt
            .prompt({
              sessionID: child.id,
              model: {
                providerID: ProviderV2.ID.make(executor.providerID!),
                modelID: ProviderV2.ModelID.make(executor.modelID!),
              },
              ...(executor.agent ? { agent: executor.agent } : {}),
              // A check's verdict is machine-read, so it is a structured
              // output contract rather than prose the runtime has to guess at.
              ...(node.kind === "check" ? { format: { type: "json_schema" as const, schema: VERDICT_SCHEMA } } : {}),
              parts: [{ type: "text", text }],
            })
            .pipe(
              Effect.tapError(() => (signal.aborted ? prompt.cancel(child.id).pipe(Effect.ignore) : Effect.void)),
              Effect.catch((error) => Effect.fail(new Error(`Node "${node.title}" failed: ${String(error)}`))),
            )

          if (result.info.role === "assistant" && result.info.error) {
            return yield* Effect.fail(new Error(`Node "${node.title}" failed: ${errorText(result.info.error)}`))
          }
          const report = result.parts
            .flatMap((part) => (part.type === "text" && !part.synthetic && part.text.trim() ? [part.text.trim()] : []))
            .join("\n")
          const verdict =
            node.kind === "check" && result.info.role === "assistant" ? decodeVerdict(result.info.structured) : undefined
          if (node.kind === "check" && !verdict) {
            return yield* Effect.fail(new Error(`Check "${node.title}" returned no verdict.`))
          }
          yield* store
            .patchNodes(goal.id, [
              {
                nodeID: node.id,
                patch: {
                  result: verdict ? verdictText(verdict) : report || `Node "${node.title}" produced no output.`,
                  ...(verdict ? { verdict } : {}),
                },
              },
            ])
            .pipe(Effect.orDie)
          return {
            nodeID: node.id,
            sessionID: child.id,
            costUsd: result.info.role === "assistant" ? result.info.cost : 0,
            ...(verdict ? { passed: verdict.pass } : {}),
          } satisfies NodeResult
        }),
      )
    })

    return GoalExecution.of({ executeNode })
  }),
)

const decode = Schema.decodeUnknownOption(Verdict)

function decodeVerdict(structured: unknown) {
  const decoded = decode(structured)
  return decoded._tag === "Some" ? decoded.value : undefined
}

function verdictText(verdict: Verdict) {
  return [
    `${verdict.pass ? "PASS" : "FAIL"}: ${verdict.summary}`,
    ...verdict.findings.map((finding) => `- ${finding}`),
  ].join("\n")
}

function errorText(error: unknown) {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message
  }
  return JSON.stringify(error)
}
