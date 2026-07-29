export * as EventRetention from "./retention"

import { sql } from "drizzle-orm"
import { Duration, Effect, Schedule } from "effect"
import type { Database } from "../database/database"

/**
 * Compaction for the append-only `event` journal.
 *
 * The v1 session projector is insert-or-update-by-id for every entity it owns,
 * so the only two revisions of an entity that leave a trace are the first (it
 * performs the insert, which fixes the row's `time_created` and its position in
 * the stream) and the last (it fixes the row's final `data`). Everything in
 * between is dead weight: a chatty tool call used to append tens of MB of
 * intermediate part JSON that nothing will ever read again.
 *
 * Keeping the first revision as well as the last is what makes the rewritten
 * stream *exactly* equivalent rather than nearly so. Dropping it would move an
 * entity's insert to wherever its final revision sits, which reorders inserts
 * past rows that reference them - a message whose last revision trails its own
 * parts would fail `part.message_id`'s foreign key on replay - and would stamp
 * `part.time_created` from the wrong revision.
 *
 * Created, deleted and removed events are never touched, and no aggregate is
 * ever time-pruned as a whole, so session warp and `/sync/history` still replay
 * a stream that lands on identical rows - just a much shorter one. Sequence
 * numbers become sparse, which is why `commitSyncEvent` and `replayAll` require
 * sequences to be strictly increasing rather than dense.
 */

const MAINTENANCE_INTERVAL_MS = 60_000
const MAINTENANCE_BATCH_SIZE = 5_000
const AGGREGATES_PER_PASS = 64
const DELETE_CHUNK = 500

const PART_UPDATED = "message.part.updated.1"
const MESSAGE_UPDATED = "message.updated.1"
const SESSION_UPDATED = "session.updated.1"

/**
 * Types whose rows are revisions of an entity, and therefore compactable.
 * `session.created` / `session.deleted`, `message.removed` and
 * `message.part.removed` are absent on purpose: they are not revisions of
 * anything, and dropping one would change the replayed result.
 */
const COMPACTABLE = [PART_UPDATED, MESSAGE_UPDATED, SESSION_UPDATED]

/**
 * Identity of the entity a row revises, within its aggregate. A part revises a
 * part, a message revises a message, and `session.updated` revises the
 * aggregate itself so its key is constant.
 */
const ENTITY = sql`CASE type
  WHEN ${PART_UPDATED} THEN json_extract(data, '$.part.id')
  WHEN ${MESSAGE_UPDATED} THEN json_extract(data, '$.info.id')
  ELSE ''
END`

export type RetentionOptions = {
  maintenanceIntervalMs?: number
  maintenanceBatchSize?: number
  aggregatesPerPass?: number
}

export interface Retention {
  /** Runs one bounded compaction pass. Returns the number of rows deleted. */
  compact: () => Effect.Effect<number>
}

type Barrier = <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>

export const make = Effect.fn("EventRetention.make")(function* (
  db: Database.Interface["db"],
  barrier: Barrier,
  options?: RetentionOptions,
) {
  const settings = {
    maintenanceIntervalMs: Math.max(1, options?.maintenanceIntervalMs ?? MAINTENANCE_INTERVAL_MS),
    maintenanceBatchSize: Math.max(1, options?.maintenanceBatchSize ?? MAINTENANCE_BATCH_SIZE),
    aggregatesPerPass: Math.max(1, options?.aggregatesPerPass ?? AGGREGATES_PER_PASS),
  }

  // The journal is only indexed by (aggregate_id, seq), so a pass walks a
  // window of aggregates rather than scanning the whole table. The cursor
  // rotates so every aggregate is visited eventually, and it stays put while a
  // window is still shedding a full batch so a backlogged aggregate drains at
  // batch-size per pass instead of once per full rotation.
  let cursor = ""

  const window = Effect.fnUntraced(function* () {
    const rows = yield* db
      .all<{ aggregate: string }>(
        sql`SELECT aggregate_id AS aggregate FROM event_sequence
            WHERE aggregate_id > ${cursor}
            ORDER BY aggregate_id
            LIMIT ${settings.aggregatesPerPass}`,
      )
      .pipe(Effect.orDie)
    return rows.map((row) => row.aggregate)
  })

  const advance = (aggregates: string[]) => {
    cursor = aggregates.length < settings.aggregatesPerPass ? "" : (aggregates.at(-1) ?? "")
  }

  /**
   * Rows in the window that are neither the first nor the last revision of
   * their entity. Both `ROW_NUMBER`s partition over the entity's full history
   * inside the window's aggregates, so the two survivors are the true global
   * first and last even when the batch limit leaves losers behind for a later
   * pass - which is also what makes the pass idempotent.
   */
  const superseded = (aggregates: string[]) =>
    db
      .all<{ id: string }>(
        sql`SELECT id FROM (
              SELECT id,
                ROW_NUMBER() OVER (
                  PARTITION BY aggregate_id, type, ${ENTITY} ORDER BY seq DESC
                ) AS newest,
                ROW_NUMBER() OVER (
                  PARTITION BY aggregate_id, type, ${ENTITY} ORDER BY seq ASC
                ) AS oldest
              FROM event
              WHERE aggregate_id IN ${aggregates} AND type IN ${COMPACTABLE}
            )
            WHERE newest > 1 AND oldest > 1
            LIMIT ${settings.maintenanceBatchSize}`,
      )
      .pipe(Effect.orDie)

  const compact = Effect.fn("EventRetention.compact")(function* () {
    const aggregates = yield* window()
    if (aggregates.length === 0) {
      cursor = ""
      return 0
    }
    // The read runs outside the write transaction on purpose: a concurrent
    // append can only add a higher sequence, which cannot turn a row already
    // classified as superseded back into the first or last revision.
    const doomed = yield* superseded(aggregates)
    if (doomed.length === 0) {
      advance(aggregates)
      return 0
    }
    const ids = doomed.map((row) => row.id)
    yield* barrier(
      db
        .transaction(
          (transaction) =>
            Effect.gen(function* () {
              for (let index = 0; index < ids.length; index += DELETE_CHUNK) {
                yield* transaction.run(sql`DELETE FROM event WHERE id IN ${ids.slice(index, index + DELETE_CHUNK)}`)
              }
            }),
          { behavior: "immediate" },
        )
        .pipe(Effect.orDie),
    )
    // A saturated batch means this window still has more to shed, so hold the
    // cursor rather than waiting a full rotation to come back to it.
    if (ids.length < settings.maintenanceBatchSize) advance(aggregates)
    return ids.length
  })

  return { compact } satisfies Retention
})

/** Starts the background compaction loop in the current scope. */
export const start = Effect.fnUntraced(function* (
  db: Database.Interface["db"],
  barrier: Barrier,
  options?: RetentionOptions,
) {
  const retention = yield* make(db, barrier, options)
  const interval = Math.max(1, options?.maintenanceIntervalMs ?? MAINTENANCE_INTERVAL_MS)
  yield* Effect.sleep(Duration.millis(interval)).pipe(
    Effect.andThen(retention.compact()),
    // A failed pass (e.g. SQLITE_BUSY outliving the busy timeout in
    // multi-process use) must not kill the loop for the life of the process;
    // log it and try again next interval.
    Effect.catchCause((cause) => Effect.logWarning("event retention pass failed", { cause })),
    Effect.repeat(Schedule.forever),
    Effect.forkScoped,
  )
  return retention
})
