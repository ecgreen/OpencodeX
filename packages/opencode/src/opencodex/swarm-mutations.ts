import {
  OpencodeXSwarmAgentRunTable,
  OpencodeXSwarmRoleTable,
  OpencodeXSwarmRunTable,
  OpencodeXSwarmTable,
} from "@opencode-ai/core/opencodex/sql"
import { Database } from "@opencode-ai/core/database/database"
import { Identifier } from "@opencode-ai/core/util/identifier"
import { EventV2Bridge } from "@/event-v2-bridge"
import { OpencodeXJob } from "@/opencodex/job"
import { Context, Effect, Layer } from "effect"
import { eq, inArray } from "drizzle-orm"
import {
  PlanService,
  ReadService,
  RoleNotFoundError,
  StateEvent,
  ValidationError,
  type AddRoleInput,
  type CreateInput,
  type UpdateInput,
  type UpdateRoleInput,
} from "./swarm-schema"
import { serializeMetadata, validateRoles } from "./swarm-model"
import { SwarmExecution } from "./swarm-execution"
import { SwarmStatus } from "./swarm-status"

export type Interface = Pick<
  import("./swarm-schema").Interface,
  "create" | "update" | "cancel" | "remove" | "addRole" | "updateRole"
>

export class SwarmMutations extends Context.Service<SwarmMutations, Interface>()(
  "@opencode/OpencodeXSwarmMutations",
) {}

export const swarmMutationsLayer = Layer.effect(
  SwarmMutations,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const stateEvents = yield* EventV2Bridge.Service
    const jobs = yield* OpencodeXJob.Service
    const plans = yield* PlanService
    const reader = yield* ReadService
    const execution = yield* SwarmExecution
    const status = yield* SwarmStatus

const create = Effect.fn("OpencodeXSwarm.create")(function* (input: CreateInput) {
  const created = yield* plans.create(input)
  return yield* reader.get(created.id).pipe(Effect.orDie)
})

const update = Effect.fn("OpencodeXSwarm.update")(function* (swarmID: string, input: UpdateInput) {
  const swarm = yield* reader.get(swarmID)
  if (["queued", "running", "cancelling"].includes(swarm.status)) {
    return yield* new ValidationError({ message: "Wait for the active swarm run before editing its configuration." })
  }
  if (input.roles) {
    const invalid = validateRoles(input.roles)
    if (invalid) return yield* new ValidationError({ message: invalid })
  }
  const now = Date.now()
  const afterCommit = yield* db
    .transaction(
      (transaction) =>
        Effect.gen(function* () {
          yield* transaction
            .update(OpencodeXSwarmTable)
            .set({
              title: input.title?.trim() || undefined,
              metadata_json: input.metadata ? serializeMetadata(input.metadata) : undefined,
              time_updated: now,
            })
            .where(eq(OpencodeXSwarmTable.id, swarmID))
            .run()
          if (input.roles) {
            yield* transaction.delete(OpencodeXSwarmRoleTable).where(eq(OpencodeXSwarmRoleTable.swarm_id, swarmID)).run()
            yield* Effect.forEach(
              input.roles,
              (role, index) =>
                transaction
                  .insert(OpencodeXSwarmRoleTable)
                  .values({
                    id: `swr_${Identifier.ascending()}`,
                    swarm_id: swarmID,
                    name: role.name,
                    agent: role.agent,
                    skill: role.skill,
                    provider_id: role.providerID,
                    model_id: role.modelID,
                    model_profile: role.modelProfile,
                    status: "planned",
                    instructions: role.instructions,
                    sort_order: index,
                    metadata_json: serializeMetadata(role.metadata),
                    time_created: now,
                    time_updated: now,
                  })
                  .run(),
              { discard: true },
            )
          }
          return yield* status.commitEvent(transaction, swarmID, {
            kind: "swarm.updated",
            message: "Swarm configuration updated",
          })
        }),
      { behavior: "immediate" },
    )
    .pipe(Effect.orDie)
  yield* afterCommit
  return yield* reader.get(swarmID)
})

const cancel = Effect.fn("OpencodeXSwarm.cancel")(function* (swarmID: string) {
  const swarm = yield* reader.get(swarmID)
  if (["completed", "partially_failed", "failed", "cancelled"].includes(swarm.status)) return swarm
  const pendingRuns = swarm.runs.filter((run) => !["completed", "partially_failed", "failed", "cancelled"].includes(run.status))
  const pendingAgents = pendingRuns.flatMap((run) =>
    run.agents.filter((agentRun) => !["completed", "failed", "cancelled"].includes(agentRun.status)),
  )
  const pendingRoles = swarm.roles.filter((role) => !["completed", "failed", "cancelled"].includes(role.status))
  const now = Date.now()
  const afterCommit = yield* db
    .transaction(
      (transaction) =>
        Effect.gen(function* () {
          yield* transaction
            .update(OpencodeXSwarmTable)
            .set({ status: "cancelling", time_updated: now })
            .where(eq(OpencodeXSwarmTable.id, swarmID))
            .run()
          if (pendingRuns.length > 0) {
            yield* transaction
              .update(OpencodeXSwarmRunTable)
              .set({ status: "cancelling", time_updated: now })
              .where(inArray(OpencodeXSwarmRunTable.id, pendingRuns.map((run) => run.id)))
              .run()
          }
          if (pendingAgents.length > 0) {
            yield* transaction
              .update(OpencodeXSwarmAgentRunTable)
              .set({ status: "cancelling", time_updated: now })
              .where(inArray(OpencodeXSwarmAgentRunTable.id, pendingAgents.map((agentRun) => agentRun.id)))
              .run()
          }
          if (pendingRoles.length > 0) {
            yield* transaction
              .update(OpencodeXSwarmRoleTable)
              .set({ status: "cancelling", time_updated: now })
              .where(inArray(OpencodeXSwarmRoleTable.id, pendingRoles.map((role) => role.id)))
              .run()
          }
          return yield* status.commitEvent(transaction, swarmID, {
            kind: "swarm.cancelling",
            message: "Swarm cancellation requested",
          })
        }),
      { behavior: "immediate" },
    )
    .pipe(Effect.orDie)
  yield* afterCommit
  const relatedJobs = (yield* jobs.list()).filter(
    (job) => job.swarmID === swarmID && !["succeeded", "failed", "cancelled", "interrupted"].includes(job.status),
  )
  yield* Effect.forEach(
    relatedJobs,
    (job) =>
      jobs
        .cancel(
          job.id,
          job.kind === "swarm.synthesis"
            ? status.settleSynthesisJob
            : ["swarm.orchestrator", "swarm.worker"].includes(job.kind)
              ? status.settleRoleJob
              : undefined,
        )
        .pipe(Effect.ignore),
    { concurrency: "unbounded", discard: true },
  )
  yield* Effect.forEach(
    [
      ...new Set(
        [
          ...pendingRuns.map((run) => run.orchestratorSessionID),
          ...pendingAgents.map((agentRun) => agentRun.sessionID),
          ...pendingRoles.map((role) => role.sessionID),
        ].filter((sessionID): sessionID is string => sessionID !== undefined),
      ),
    ],
    execution.cancelSessionTree,
    { concurrency: "unbounded", discard: true },
  )
  yield* Effect.forEach(
    pendingRuns,
    (run) =>
      relatedJobs.some((job) => job.metadata?.runID === run.id)
        ? status.completeIfFinished(swarmID, run.id).pipe(Effect.ignore)
        : status.updateRunStatus(swarmID, run.id, "cancelled", "Swarm cancellation acknowledged").pipe(Effect.ignore),
    { concurrency: 1, discard: true },
  )
  return yield* reader.get(swarmID)
})

const remove = Effect.fn("OpencodeXSwarm.remove")(function* (swarmID: string) {
  yield* cancel(swarmID)
  const active = (yield* jobs.list()).some(
    (job) => job.swarmID === swarmID && ["queued", "claimed", "running"].includes(job.status),
  )
  if (active) return false
  yield* db.delete(OpencodeXSwarmTable).where(eq(OpencodeXSwarmTable.id, swarmID)).run().pipe(Effect.orDie)
  yield* stateEvents.publish(StateEvent.Deleted, { swarmID })
  return true
})

const addRole = Effect.fn("OpencodeXSwarm.addRole")(function* (swarmID: string, input: AddRoleInput) {
  const swarm = yield* reader.get(swarmID)
  if (["queued", "running", "cancelling"].includes(swarm.status)) {
    return yield* new ValidationError({ message: "Wait for the active swarm run before adding a role." })
  }
  const invalid = validateRoles([...swarm.roles, input.role])
  if (invalid) return yield* new ValidationError({ message: invalid })
  const now = Date.now()
  yield* db
    .insert(OpencodeXSwarmRoleTable)
    .values({
      id: `swr_${Identifier.ascending()}`,
      swarm_id: swarmID,
      name: input.role.name,
      agent: input.role.agent,
      skill: input.role.skill,
      provider_id: input.role.providerID,
      model_id: input.role.modelID,
      model_profile: input.role.modelProfile,
      status: "planned",
      instructions: input.role.instructions,
      sort_order: swarm.roles.length,
      metadata_json: serializeMetadata(input.role.metadata),
      time_created: now,
      time_updated: now,
    })
    .run()
    .pipe(Effect.orDie)
  yield* status.event(swarmID, { kind: "swarm.role.added", message: `${input.role.name} added` })
  return yield* reader.get(swarmID)
})

const updateRole = Effect.fn("OpencodeXSwarm.updateRole")(function* (
  swarmID: string,
  roleID: string,
  input: UpdateRoleInput,
) {
  const swarm = yield* reader.get(swarmID)
  if (["queued", "running", "cancelling"].includes(swarm.status)) {
    return yield* new ValidationError({ message: "Wait for the active swarm run before editing a role." })
  }
  if (!swarm.roles.some((role) => role.id === roleID)) return yield* new RoleNotFoundError({ swarmID, roleID })
  const invalid = validateRoles(
    swarm.roles.map((role) =>
      role.id === roleID
        ? { ...role, name: input.name ?? role.name, instructions: input.instructions ?? role.instructions }
        : role,
    ),
  )
  if (invalid) return yield* new ValidationError({ message: invalid })
  yield* db
    .update(OpencodeXSwarmRoleTable)
    .set({
      name: input.name,
      agent: input.agent,
      skill: input.skill,
      provider_id: input.providerID,
      model_id: input.modelID,
      model_profile: input.modelProfile,
      instructions: input.instructions,
      metadata_json: serializeMetadata(input.metadata),
      time_updated: Date.now(),
    })
    .where(eq(OpencodeXSwarmRoleTable.id, roleID))
    .run()
    .pipe(Effect.orDie)
  yield* status.event(swarmID, { roleID, kind: "swarm.role.updated", message: "Role updated" })
  return yield* reader.get(swarmID)
})

    return SwarmMutations.of({ create, update, cancel, remove, addRole, updateRole })
  }),
)
