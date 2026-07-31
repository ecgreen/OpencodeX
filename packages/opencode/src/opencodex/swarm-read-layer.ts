import {
  OpencodeXSwarmEventTable,
  OpencodeXSwarmRoleTable,
  OpencodeXSwarmTable,
} from "@opencode-ai/core/opencodex/sql"
import { Database } from "@opencode-ai/core/database/database"
import { Effect, Layer } from "effect"
import { eq, inArray } from "drizzle-orm"
import { NotFoundError, ReadService } from "./swarm-schema"
import { hydrate } from "./swarm-model"

export const readLayer = Layer.effect(
  ReadService,
  Effect.gen(function* () {
    const { db } = yield* Database.Service

    const get = Effect.fn("OpencodeXSwarmRead.get")(function* (swarmID: string) {
      const swarm = yield* db
        .select()
        .from(OpencodeXSwarmTable)
        .where(eq(OpencodeXSwarmTable.id, swarmID))
        .get()
        .pipe(Effect.orDie)
      if (!swarm) return yield* new NotFoundError({ swarmID })
      const [roles, events] = yield* Effect.all(
        [
          db
            .select()
            .from(OpencodeXSwarmRoleTable)
            .where(eq(OpencodeXSwarmRoleTable.swarm_id, swarmID))
            .orderBy(OpencodeXSwarmRoleTable.sort_order, OpencodeXSwarmRoleTable.time_created)
            .all()
            .pipe(Effect.orDie),
          db
            .select()
            .from(OpencodeXSwarmEventTable)
            .where(eq(OpencodeXSwarmEventTable.swarm_id, swarmID))
            .orderBy(OpencodeXSwarmEventTable.time_created)
            .all()
            .pipe(Effect.orDie),
        ],
        { concurrency: "unbounded" },
      )
      return hydrate({ swarm, roles, events })
    })

    const list = Effect.fn("OpencodeXSwarmRead.list")(function* () {
      const swarms = (yield* db
        .select()
        .from(OpencodeXSwarmTable)
        .orderBy(OpencodeXSwarmTable.time_updated)
        .all()
        .pipe(Effect.orDie)).toReversed()
      if (swarms.length === 0) return []
      const ids = swarms.map((swarm) => swarm.id)
      const [roles, history] = yield* Effect.all(
        [
          db
            .select()
            .from(OpencodeXSwarmRoleTable)
            .where(inArray(OpencodeXSwarmRoleTable.swarm_id, ids))
            .orderBy(OpencodeXSwarmRoleTable.swarm_id, OpencodeXSwarmRoleTable.sort_order)
            .all()
            .pipe(Effect.orDie),
          db
            .select()
            .from(OpencodeXSwarmEventTable)
            .where(inArray(OpencodeXSwarmEventTable.swarm_id, ids))
            .orderBy(OpencodeXSwarmEventTable.swarm_id, OpencodeXSwarmEventTable.time_created)
            .all()
            .pipe(Effect.orDie),
        ],
        { concurrency: "unbounded" },
      )
      const rolesBySwarm = Map.groupBy(roles, (row) => row.swarm_id)
      const eventsBySwarm = Map.groupBy(history, (row) => row.swarm_id)
      return swarms.map((swarm) =>
        hydrate({
          swarm,
          roles: rolesBySwarm.get(swarm.id) ?? [],
          events: eventsBySwarm.get(swarm.id) ?? [],
        }),
      )
    })

    return ReadService.of({ list, get })
  }),
)
