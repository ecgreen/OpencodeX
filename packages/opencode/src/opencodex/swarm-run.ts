import {
  OpencodeXSwarmAgentRunTable,
  OpencodeXSwarmRoleTable,
  OpencodeXSwarmRunTable,
  OpencodeXSwarmTable,
} from "@opencode-ai/core/opencodex/sql"
import { Database } from "@opencode-ai/core/database/database"
import { Identifier } from "@opencode-ai/core/util/identifier"
import { Agent } from "@/agent/agent"
import { EventV2Bridge } from "@/event-v2-bridge"
import { OpencodeXJob } from "@/opencodex/job"
import { OpencodeXJobDispatcher } from "@/opencodex/job-dispatcher"
import { insertJob } from "@/opencodex/job-store"
import { Provider } from "@/provider/provider"
import { MessageID, SessionID } from "@/session/schema"
import { Context, Effect, Layer } from "effect"
import { and, eq, notInArray } from "drizzle-orm"
import {
  ReadService,
  NotFoundError,
  ValidationError,
  type AssignTaskInput,
  type Info,
  type Role,
} from "./swarm-schema"
import {
  defaultTitle,
  executionMode,
  isOrchestratorRole,
  selectedRoleModel,
  serializeMetadata,
  validateRoles,
} from "./swarm-model"
import { SwarmStatus } from "./swarm-status"

type RunInput = {
  prompt: string
  agent?: string
  mode?: "build" | "plan"
  variant?: string
}

export interface Interface {
  readonly createRun: (
    swarmID: string,
    input: RunInput,
  ) => Effect.Effect<Info, NotFoundError | ValidationError>
  readonly start: (swarmID: string) => Effect.Effect<Info, NotFoundError | ValidationError>
  readonly assignTask: (
    swarmID: string,
    input: AssignTaskInput,
  ) => Effect.Effect<Info, NotFoundError | ValidationError>
}

export class SwarmRun extends Context.Service<SwarmRun, Interface>()("@opencode/OpencodeXSwarmRun") {}

export const swarmRunLayer = Layer.effect(
  SwarmRun,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const reader = yield* ReadService
    const events = yield* EventV2Bridge.Service
    const dispatcher = yield* OpencodeXJobDispatcher.Service
    const agents = yield* Agent.Service
    const provider = yield* Provider.Service
    const status = yield* SwarmStatus

const defaultModel = Effect.fn("OpencodeXSwarm.defaultRunModel")(function* () {
  const missing = "Select a model for every swarm role or configure a default model."
  return yield* provider.defaultModel().pipe(
    Effect.catchTags({
      ProviderModelNotFoundError: () => Effect.fail(new ValidationError({ message: missing })),
      ProviderNoModelsError: () => Effect.fail(new ValidationError({ message: missing })),
      ProviderNoProvidersError: () => Effect.fail(new ValidationError({ message: missing })),
    }),
  )
})

const resolveAgent = Effect.fn("OpencodeXSwarm.resolveRunAgent")(function* (requested?: string) {
  if (!requested) return yield* agents.defaultAgent().pipe(Effect.orDie)
  return yield* agents.get(requested).pipe(
    Effect.as(requested),
    Effect.catchCause(() => agents.defaultAgent().pipe(Effect.orDie)),
  )
})

const createRoleJobInput = Effect.fn("OpencodeXSwarm.createRoleJobInput")(function* (input: {
  swarm: Info
  runID: string
  role: Role
  phase: "orchestrator" | "worker"
  parentJobID?: string
  agent?: string
  executionMode: "build" | "plan"
  variant?: string
  now: number
}) {
  const model = selectedRoleModel(input.role) ?? (yield* defaultModel())
  const agent = yield* resolveAgent(input.agent ?? input.role.agent)
  const job: OpencodeXJob.CreateInputType = {
    id: `oxj_${Identifier.ascending()}`,
    kind: `swarm.${input.phase}`,
    title: `${input.swarm.title}: ${input.role.name}`,
    source: "swarm",
    projectID: input.swarm.projectID,
    parentJobID: input.parentJobID,
    swarmID: input.swarm.id,
    roleID: input.role.id,
    agent,
    providerID: model.providerID,
    modelID: model.modelID,
    idempotencyKey: `${input.runID}:${input.role.id}`,
    maxAttempts: 2,
    timeoutAt: input.now + 2 * 60 * 60 * 1_000,
    metadata: {
      runID: input.runID,
      phase: input.phase,
      executionMode: input.executionMode,
      variant: input.variant,
      sessionID: SessionID.descending(),
      messageID: MessageID.ascending(),
      dispatchReady: true,
    },
  }
  return job
})

const createRunUnlocked = Effect.fn("OpencodeXSwarm.createRunUnlocked")(function* (swarmID: string, input: RunInput) {
  const swarm = yield* reader.get(swarmID)
  if (swarm.status === "cancelled") {
    return yield* new ValidationError({ message: "Cancelled swarms cannot run tasks." })
  }
  if (swarm.runs.some((run) => ["queued", "running", "cancelling"].includes(run.status))) {
    return yield* new ValidationError({ message: "This swarm already has an active run." })
  }
  const invalid = validateRoles(swarm.roles)
  if (invalid) return yield* new ValidationError({ message: invalid })
  const orchestrator = swarm.roles.find(isOrchestratorRole)
  if (!orchestrator) return yield* new ValidationError({ message: "A swarm requires an Orchestrator role." })
  const runID = `swrn_${Identifier.ascending()}`
  const now = Date.now()
  const mode = executionMode(input)
  const orchestratorJobInput = yield* createRoleJobInput({
    swarm,
    runID,
    role: orchestrator,
    phase: "orchestrator",
    agent: input.agent,
    executionMode: mode,
    variant: input.variant,
    now,
  })
  const workerPlans = yield* Effect.forEach(
    swarm.roles.filter((role) => role.id !== orchestrator.id),
    Effect.fnUntraced(function* (role) {
      const job = yield* createRoleJobInput({
        swarm,
        runID,
        role,
        phase: "worker",
        parentJobID: orchestratorJobInput.id,
        executionMode: mode,
        variant: input.variant,
        now,
      })
      return { role, job, agentRunID: `swar_${Identifier.ascending()}` }
    }),
    { concurrency: 1 },
  )
  const orchestratorRunID = `swar_${Identifier.ascending()}`
  const afterCommit = yield* events.barrier(
    Effect.gen(function* () {
      const latest = yield* reader.get(swarmID)
      if (latest.runs.some((run) => ["queued", "running", "cancelling"].includes(run.status))) return undefined
      return yield* db.transaction(
      (transaction) =>
        Effect.gen(function* () {
          const claimed = yield* transaction
            .update(OpencodeXSwarmTable)
            .set({
              title: swarm.title === "New swarm" ? defaultTitle(input.prompt) : undefined,
              prompt: input.prompt,
              status: "queued",
              completed_at: null,
              synthesis_session_id: null,
              time_updated: now,
            })
            .where(
              and(
                eq(OpencodeXSwarmTable.id, swarmID),
                notInArray(OpencodeXSwarmTable.status, ["queued", "running", "cancelling"]),
              ),
            )
            .returning({ id: OpencodeXSwarmTable.id })
            .get()
          if (!claimed) return undefined
          const orchestratorJob = yield* insertJob(transaction, events, orchestratorJobInput)
          const workerJobs = yield* Effect.forEach(
            workerPlans,
            Effect.fnUntraced(function* (plan) {
              return { ...plan, committed: yield* insertJob(transaction, events, plan.job) }
            }),
            { concurrency: 1 },
          )
          yield* transaction
            .insert(OpencodeXSwarmRunTable)
            .values({
              id: runID,
              swarm_id: swarmID,
              opencodex_project_id: swarm.projectID,
              title: defaultTitle(input.prompt),
              prompt: input.prompt,
              status: "queued",
              source: "swarm",
              metadata_json: serializeMetadata({ orchestratorRoleID: orchestrator.id, executionMode: mode }),
              time_created: now,
              time_updated: now,
            })
            .run()
          yield* transaction
            .insert(OpencodeXSwarmAgentRunTable)
            .values({
              id: orchestratorRunID,
              run_id: runID,
              swarm_id: swarmID,
              role_id: orchestrator.id,
              status: "queued",
              prompt: input.prompt,
              job_id: orchestratorJob.result.id,
              time_created: now,
              time_updated: now,
            })
            .run()
          yield* Effect.forEach(
            workerJobs,
            (plan) =>
              transaction
                .insert(OpencodeXSwarmAgentRunTable)
                .values({
                  id: plan.agentRunID,
                  run_id: runID,
                  swarm_id: swarmID,
                  role_id: plan.role.id,
                  status: "queued",
                  prompt: input.prompt,
                  job_id: plan.committed.result.id,
                  time_created: now,
                  time_updated: now,
                })
                .run(),
            { discard: true },
          )
          yield* Effect.forEach(
            [{ role: orchestrator, job: orchestratorJob.result }, ...workerJobs.map((plan) => ({
              role: plan.role,
              job: plan.committed.result,
            }))],
            (plan) =>
              transaction
                .update(OpencodeXSwarmRoleTable)
                .set({ status: "queued", session_id: null, job_id: plan.job.id, time_updated: now })
                .where(eq(OpencodeXSwarmRoleTable.id, plan.role.id))
                .run(),
            { discard: true },
          )
          const swarmEvent = yield* status.commitEvent(transaction, swarmID, {
            runID,
            kind: "swarm.run.queued",
            message: "Swarm run queued",
          })
          return [
            ...(orchestratorJob.event ? [events.broadcast(orchestratorJob.event).pipe(Effect.asVoid)] : []),
            ...workerJobs.flatMap((plan) =>
              plan.committed.event ? [events.broadcast(plan.committed.event).pipe(Effect.asVoid)] : [],
            ),
            swarmEvent,
          ]
        }),
      { behavior: "immediate" },
    )
      .pipe(
        Effect.catchTag("SqlError", Effect.die),
        Effect.catchTag("EffectDrizzleQueryError", Effect.die),
      )
    }),
  )
  if (!afterCommit) return yield* new ValidationError({ message: "This swarm already has an active run." })
  yield* Effect.forEach(afterCommit, (effect) => effect, { concurrency: 1, discard: true })
  yield* dispatcher.wake()
  return yield* reader.get(swarmID)
})

const createRun = Effect.fn("OpencodeXSwarm.createRun")(function* (swarmID: string, input: RunInput) {
  return yield* events.barrier(createRunUnlocked(swarmID, input))
})

const start = Effect.fn("OpencodeXSwarm.start")(function* (swarmID: string) {
  const swarm = yield* reader.get(swarmID)
  const planned = swarm.runs.find((run) => run.status === "planned")
  if (planned) return yield* createRun(swarmID, { prompt: planned.prompt })
  if (!swarm.prompt.trim()) {
    return yield* new ValidationError({ message: "Assign a task before starting this swarm." })
  }
  return yield* createRun(swarmID, { prompt: swarm.prompt })
})

const assignTask = Effect.fn("OpencodeXSwarm.assignTask")(function* (
  swarmID: string,
  input: AssignTaskInput,
) {
  const prompt = input.prompt.trim()
  if (!prompt) return yield* new ValidationError({ message: "Swarm run prompt cannot be empty." })
  const result = yield* createRun(swarmID, {
    prompt,
    agent: input.agent,
    mode: input.mode,
    variant: input.variant,
  })
  yield* status.event(swarmID, { kind: "swarm.task.assigned", message: "Task assigned to swarm team" })
  return result
})

    return SwarmRun.of({ createRun, start, assignTask })
  }),
)
