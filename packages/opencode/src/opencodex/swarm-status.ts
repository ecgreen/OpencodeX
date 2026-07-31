import { OpencodeXSwarmEventTable } from "@opencode-ai/core/opencodex/sql"
import { Database } from "@opencode-ai/core/database/database"
import { Identifier } from "@opencode-ai/core/util/identifier"
import { EventV2Bridge } from "@/event-v2-bridge"
import { OpencodeXJob } from "@/opencodex/job"
import { SessionID } from "@/session/schema"
import { Context, Effect, Layer } from "effect"
import { StateEvent } from "./swarm-schema"
import { serializeMetadata } from "./swarm-model"

export type EventInput = {
  roleID?: string
  sessionID?: SessionID
  kind: string
  message: string
  metadata?: Record<string, unknown>
}

export interface Interface {
  readonly commitEvent: (
    transaction: OpencodeXJob.Transaction,
    swarmID: string,
    input: EventInput,
  ) => Effect.Effect<Effect.Effect<void>>
  readonly event: (swarmID: string, input: EventInput) => Effect.Effect<void>
}

export class SwarmStatus extends Context.Service<SwarmStatus, Interface>()("@opencode/OpencodeXSwarmStatus") {}

export const swarmStatusLayer = Layer.effect(
  SwarmStatus,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const stateEvents = yield* EventV2Bridge.Service

    const commitEvent = (transaction: OpencodeXJob.Transaction, swarmID: string, input: EventInput) =>
      Effect.gen(function* () {
        const now = Date.now()
        yield* transaction
          .insert(OpencodeXSwarmEventTable)
          .values({
            id: `oxe_${Identifier.ascending()}`,
            swarm_id: swarmID,
            role_id: input.roleID,
            session_id: input.sessionID,
            kind: input.kind,
            message: input.message,
            metadata_json: serializeMetadata(input.metadata),
            time_created: now,
            time_updated: now,
          })
          .run()
        const committed = yield* stateEvents.commit(StateEvent.Updated, { swarmID })
        return stateEvents.broadcast(committed).pipe(Effect.asVoid)
      }).pipe(Effect.orDie)

    const event = Effect.fn("OpencodeXSwarm.event")(function* (swarmID: string, input: EventInput) {
      const afterCommit = yield* stateEvents.barrier(
        db
          .transaction((transaction) => commitEvent(transaction, swarmID, input), { behavior: "immediate" })
          .pipe(Effect.orDie),
      )
      yield* afterCommit
    })

    return SwarmStatus.of({ commitEvent, event })
  }),
)
