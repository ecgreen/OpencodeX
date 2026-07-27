import {
  OpencodeXSwarmEventTable,
  OpencodeXSwarmRoleTable,
  OpencodeXSwarmTable,
} from "@opencode-ai/core/opencodex/sql"
import { Database } from "@opencode-ai/core/database/database"
import { Identifier } from "@opencode-ai/core/util/identifier"
import { EventV2Bridge } from "@/event-v2-bridge"
import { OpencodeXProject } from "@/opencodex/project"
import { Effect, Layer } from "effect"
import {
  PlanService,
  StateEvent,
  ValidationError,
  type CreateInput,
} from "./swarm-schema"
import {
  defaultRoles,
  defaultTitle,
  serializeMetadata,
  validateRoles,
} from "./swarm-model"

export const planLayer = Layer.effect(
  PlanService,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const events = yield* EventV2Bridge.Service
    const projects = yield* OpencodeXProject.Service

    const create = Effect.fn("OpencodeXSwarmPlan.create")(function* (input: CreateInput) {
      yield* projects.get(input.projectID)
      const swarmID = `swm_${Identifier.ascending()}`
      const now = Date.now()
      const prompt = input.prompt?.trim() ?? ""
      const roles = input.roles && input.roles.length > 0 ? [...input.roles] : defaultRoles(prompt)
      const invalid = validateRoles(roles)
      if (invalid) return yield* new ValidationError({ message: invalid })
      const title = input.title?.trim() || defaultTitle(prompt)
      const event = yield* events.barrier(
        db.transaction(
          (tx) =>
            Effect.gen(function* () {
              yield* tx
                .insert(OpencodeXSwarmTable)
                .values({
                  id: swarmID,
                  opencodex_project_id: input.projectID,
                  title,
                  prompt,
                  status: "planned",
                  source: input.source ?? "manual",
                  created_by: input.createdBy,
                  metadata_json: serializeMetadata(input.metadata),
                  time_created: now,
                  time_updated: now,
                })
                .run()
              yield* Effect.forEach(
                roles,
                (role, index) =>
                  tx
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
              yield* tx
                .insert(OpencodeXSwarmEventTable)
                .values({
                  id: `oxe_${Identifier.ascending()}`,
                  swarm_id: swarmID,
                  kind: "swarm.created",
                  message: "Swarm plan created",
                  time_created: now,
                  time_updated: now,
                })
                .run()
              return yield* events.commit(StateEvent.Created, { swarmID })
            }),
          { behavior: "immediate" },
        ).pipe(Effect.orDie),
      )
      yield* events.broadcast(event)
      return { id: swarmID, title, roles }
    })

    return PlanService.of({ create })
  }),
)
