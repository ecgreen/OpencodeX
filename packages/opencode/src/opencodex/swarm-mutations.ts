import { OpencodeXSwarmRoleTable, OpencodeXSwarmTable } from "@opencode-ai/core/opencodex/sql"
import { Database } from "@opencode-ai/core/database/database"
import { Identifier } from "@opencode-ai/core/util/identifier"
import { EventV2Bridge } from "@/event-v2-bridge"
import { OpencodeXJob } from "@/opencodex/job"
import { Context, Effect, Layer } from "effect"
import { and, eq, notInArray } from "drizzle-orm"
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
    const status = yield* SwarmStatus

const create = Effect.fn("OpencodeXSwarm.create")(function* (input: CreateInput) {
  const created = yield* plans.create(input)
  return yield* reader.get(created.id).pipe(Effect.orDie)
})

const updateUnlocked = Effect.fnUntraced(function* (swarmID: string, input: UpdateInput) {
  const swarm = yield* reader.get(swarmID)
  if (["queued", "running", "cancelling"].includes(swarm.status)) {
    return yield* new ValidationError({ message: "Wait for the active swarm run before editing its configuration." })
  }
  if (input.roles) {
    const invalid = validateRoles(input.roles)
    if (invalid) return yield* new ValidationError({ message: invalid })
  }
  const now = Date.now()
  const afterCommit = yield* stateEvents.barrier(
    db.transaction(
      (transaction) =>
        Effect.gen(function* () {
          const updated = yield* transaction
            .update(OpencodeXSwarmTable)
            .set({
              title: input.title?.trim() || undefined,
              metadata_json: input.metadata ? serializeMetadata(input.metadata) : undefined,
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
          if (!updated) return undefined
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
                    variant: role.variant,
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
    ).pipe(Effect.orDie),
  )
  if (!afterCommit) {
    return yield* new ValidationError({ message: "Wait for the active swarm run before editing its configuration." })
  }
  yield* afterCommit
  return yield* reader.get(swarmID)
})

const update = Effect.fn("OpencodeXSwarm.update")(function* (swarmID: string, input: UpdateInput) {
  return yield* stateEvents.barrier(updateUnlocked(swarmID, input))
})

const cancelUnlocked = Effect.fnUntraced(function* (swarmID: string) {
  const swarm = yield* reader.get(swarmID)
  if (["completed", "partially_failed", "failed", "cancelled"].includes(swarm.status)) return swarm
  const now = Date.now()
  const afterCommit = yield* stateEvents.barrier(
    db.transaction(
      (transaction) =>
        Effect.gen(function* () {
          const updated = yield* transaction
            .update(OpencodeXSwarmTable)
            .set({ status: "cancelled", completed_at: now, time_updated: now })
            .where(
              and(
                eq(OpencodeXSwarmTable.id, swarmID),
                notInArray(OpencodeXSwarmTable.status, ["completed", "partially_failed", "failed", "cancelled"]),
              ),
            )
            .returning({ id: OpencodeXSwarmTable.id })
            .get()
          if (!updated) return undefined
          return yield* status.commitEvent(transaction, swarmID, {
            kind: "swarm.cancelled",
            message: "Swarm cancelled",
          })
        }),
      { behavior: "immediate" },
    ).pipe(Effect.orDie),
  )
  if (afterCommit) yield* afterCommit
  return yield* reader.get(swarmID)
})

const cancel = Effect.fn("OpencodeXSwarm.cancel")(function* (swarmID: string) {
  return yield* stateEvents.barrier(cancelUnlocked(swarmID))
})

const removeUnlocked = Effect.fnUntraced(function* (swarmID: string) {
  yield* cancelUnlocked(swarmID)
  const active = (yield* jobs.list()).some(
    (job) => job.swarmID === swarmID && ["queued", "claimed", "running"].includes(job.status),
  )
  if (active) return false
  const event = yield* db
    .transaction(
      (transaction) =>
        Effect.gen(function* () {
          yield* transaction.delete(OpencodeXSwarmTable).where(eq(OpencodeXSwarmTable.id, swarmID)).run()
          return yield* stateEvents.commit(StateEvent.Deleted, { swarmID })
        }),
      { behavior: "immediate" },
    )
    .pipe(Effect.orDie)
  yield* stateEvents.broadcast(event)
  return true
})

const remove = Effect.fn("OpencodeXSwarm.remove")(function* (swarmID: string) {
  return yield* stateEvents.barrier(removeUnlocked(swarmID))
})

const addRoleUnlocked = Effect.fnUntraced(function* (swarmID: string, input: AddRoleInput) {
  const swarm = yield* reader.get(swarmID)
  if (["queued", "running", "cancelling"].includes(swarm.status)) {
    return yield* new ValidationError({ message: "Wait for the active swarm run before adding a role." })
  }
  const invalid = validateRoles([...swarm.roles, input.role])
  if (invalid) return yield* new ValidationError({ message: invalid })
  const now = Date.now()
  const afterCommit = yield* db
    .transaction(
      (transaction) =>
        Effect.gen(function* () {
          yield* transaction
            .insert(OpencodeXSwarmRoleTable)
            .values({
              id: `swr_${Identifier.ascending()}`,
              swarm_id: swarmID,
              name: input.role.name,
              agent: input.role.agent,
              skill: input.role.skill,
              provider_id: input.role.providerID,
              model_id: input.role.modelID,
              variant: input.role.variant,
              model_profile: input.role.modelProfile,
              status: "planned",
              instructions: input.role.instructions,
              sort_order: swarm.roles.length,
              metadata_json: serializeMetadata(input.role.metadata),
              time_created: now,
              time_updated: now,
            })
            .run()
          return yield* status.commitEvent(transaction, swarmID, {
            kind: "swarm.role.added",
            message: `${input.role.name} added`,
          })
        }),
      { behavior: "immediate" },
    )
    .pipe(Effect.orDie)
  yield* afterCommit
  return yield* reader.get(swarmID)
})

const addRole = Effect.fn("OpencodeXSwarm.addRole")(function* (swarmID: string, input: AddRoleInput) {
  return yield* stateEvents.barrier(addRoleUnlocked(swarmID, input))
})

const updateRoleUnlocked = Effect.fnUntraced(function* (
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
  const afterCommit = yield* db
    .transaction(
      (transaction) =>
        Effect.gen(function* () {
          yield* transaction
            .update(OpencodeXSwarmRoleTable)
            .set({
              name: input.name,
              agent: input.agent,
              skill: input.skill,
              provider_id: input.providerID,
              model_id: input.modelID,
              variant: input.variant,
              model_profile: input.modelProfile,
              instructions: input.instructions,
              metadata_json: serializeMetadata(input.metadata),
              time_updated: Date.now(),
            })
            .where(eq(OpencodeXSwarmRoleTable.id, roleID))
            .run()
          return yield* status.commitEvent(transaction, swarmID, {
            roleID,
            kind: "swarm.role.updated",
            message: "Role updated",
          })
        }),
      { behavior: "immediate" },
    )
    .pipe(Effect.orDie)
  yield* afterCommit
  return yield* reader.get(swarmID)
})

const updateRole = Effect.fn("OpencodeXSwarm.updateRole")(function* (
  swarmID: string,
  roleID: string,
  input: UpdateRoleInput,
) {
  return yield* stateEvents.barrier(updateRoleUnlocked(swarmID, roleID, input))
})

    return SwarmMutations.of({ create, update, cancel, remove, addRole, updateRole })
  }),
)
