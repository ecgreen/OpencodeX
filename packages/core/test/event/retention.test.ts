import { describe, expect } from "bun:test"
import { asc, eq } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { EventRetention } from "@opencode-ai/core/event/retention"
import { EventTable } from "@opencode-ai/core/event/sql"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { ProjectV2 } from "@opencode-ai/core/project"
import { SessionLegacy } from "@opencode-ai/core/session/legacy"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { MessageTable, PartTable, SessionTable } from "@opencode-ai/core/session/sql"
import { testEffect } from "../lib/effect"

const layer = Layer.mergeAll(EventV2.defaultLayer, Database.defaultLayer, SessionProjector.defaultLayer)
const it = testEffect(layer)

type Db = Database.Interface["db"]

const project = (db: Db, id: ProjectV2.ID) =>
  db
    .insert(ProjectTable)
    .values({ id, worktree: `/tmp/${id}`, sandboxes: [], time_created: 1, time_updated: 1 })
    .onConflictDoNothing({ target: ProjectTable.id })
    .run()
    .pipe(Effect.orDie)

const sessionInfo = (sessionID: SessionSchema.ID, projectID: ProjectV2.ID, title: string) =>
  ({
    id: sessionID,
    slug: "slug",
    projectID,
    directory: `/tmp/${projectID}`,
    title,
    version: "test",
    time: { created: 1_000, updated: 1_000 },
  }) as unknown as typeof SessionLegacy.Event.Created.data.Type["info"]

const textPart = (sessionID: SessionSchema.ID, messageID: SessionLegacy.MessageID, partID: SessionLegacy.PartID, text: string) =>
  ({
    id: partID,
    messageID,
    sessionID,
    type: "text",
    text,
  }) as unknown as typeof SessionLegacy.Event.PartUpdated.data.Type["part"]

const messageInfo = (sessionID: SessionSchema.ID, messageID: SessionLegacy.MessageID, cost: number) =>
  ({
    id: messageID,
    sessionID,
    role: "assistant",
    cost,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: "test",
    providerID: "test",
    mode: "build",
    path: { cwd: "/tmp", root: "/tmp" },
    time: { created: 2_000 },
  }) as unknown as typeof SessionLegacy.Event.MessageUpdated.data.Type["info"]

const withoutWriteStamp = <T extends { time_updated: number }>({ time_updated: _, ...rest }: T) => rest

const journal = (db: Db, sessionID: SessionSchema.ID) =>
  db.select().from(EventTable).where(eq(EventTable.aggregate_id, sessionID)).orderBy(asc(EventTable.seq)).all().pipe(Effect.orDie)

const projection = Effect.fnUntraced(function* (db: Db, sessionID: SessionSchema.ID) {
  return {
    sessions: yield* db.select().from(SessionTable).where(eq(SessionTable.id, sessionID)).all().pipe(Effect.orDie),
    messages: yield* db
      .select()
      .from(MessageTable)
      .where(eq(MessageTable.session_id, sessionID))
      .orderBy(asc(MessageTable.id))
      .all()
      .pipe(Effect.orDie),
    parts: yield* db
      .select()
      .from(PartTable)
      .where(eq(PartTable.session_id, sessionID))
      .orderBy(asc(PartTable.id))
      .all()
      .pipe(Effect.orDie),
  }
})

/**
 * Seeds one aggregate with several revisions of the same entities plus the
 * lifecycle events compaction must never touch, then returns the ids so the
 * assertions can talk about them by name.
 */
const seed = Effect.fnUntraced(function* (events: EventV2.Interface, db: Db) {
  const suffix = Math.random().toString(36).slice(2, 10)
  const projectID = ProjectV2.ID.make(`prj_retention_${suffix}`)
  const sessionID = SessionSchema.ID.make(`ses_retention_${suffix}`)
  const messageID = SessionLegacy.MessageID.make(`msg_retention_${suffix}`)
  const kept = SessionLegacy.PartID.make(`prt_retention_a_${suffix}`)
  const other = SessionLegacy.PartID.make(`prt_retention_b_${suffix}`)
  const removed = SessionLegacy.PartID.make(`prt_retention_c_${suffix}`)

  yield* project(db, projectID)
  yield* events.publish(SessionLegacy.Event.Created, {
    sessionID,
    info: sessionInfo(sessionID, projectID, "created"),
  })
  yield* events.publish(SessionLegacy.Event.MessageUpdated, { sessionID, info: messageInfo(sessionID, messageID, 0) })
  for (const [index, text] of ["one", "two", "three", "four"].entries()) {
    yield* events.publish(SessionLegacy.Event.PartUpdated, {
      sessionID,
      part: textPart(sessionID, messageID, kept, text),
      time: 5_000 + index,
    })
  }
  yield* events.publish(SessionLegacy.Event.PartUpdated, {
    sessionID,
    part: textPart(sessionID, messageID, other, "only"),
    time: 6_000,
  })
  yield* events.publish(SessionLegacy.Event.PartUpdated, {
    sessionID,
    part: textPart(sessionID, messageID, removed, "doomed"),
    time: 7_000,
  })
  yield* events.publish(SessionLegacy.Event.PartRemoved, { sessionID, messageID, partID: removed })
  yield* events.publish(SessionLegacy.Event.MessageUpdated, {
    sessionID,
    info: messageInfo(sessionID, messageID, 1),
  })
  yield* events.publish(SessionLegacy.Event.Updated, {
    sessionID,
    info: sessionInfo(sessionID, projectID, "renamed once"),
  })
  yield* events.publish(SessionLegacy.Event.Updated, {
    sessionID,
    info: sessionInfo(sessionID, projectID, "renamed twice"),
  })

  return { projectID, sessionID, messageID, kept, other, removed }
})

const drain = Effect.fnUntraced(function* (retention: EventRetention.Retention) {
  let total = 0
  for (let pass = 0; pass < 32; pass++) {
    const deleted = yield* retention.compact()
    total += deleted
    if (deleted === 0 && pass > 0) break
  }
  return total
})

describe("EventRetention", () => {
  it.effect("drops every revision between an entity's first and last", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const { db } = yield* Database.Service
      const ids = yield* seed(events, db)
      const retention = yield* EventRetention.make(db, events.barrier, { aggregatesPerPass: 1_000 })

      const before = yield* journal(db, ids.sessionID)
      yield* drain(retention)
      const after = yield* journal(db, ids.sessionID)

      const partRevisions = (rows: typeof after) =>
        rows.filter((row) => row.type === "message.part.updated.1" && (row.data as any).part.id === ids.kept)

      expect(partRevisions(before).map((row) => (row.data as any).part.text)).toEqual(["one", "two", "three", "four"])
      expect(partRevisions(after).map((row) => (row.data as any).part.text)).toEqual(["one", "four"])
      // The survivors keep their original sequences, so the journal is sparse
      // but still ordered.
      expect(partRevisions(after).map((row) => row.seq)).toEqual([
        partRevisions(before)[0]!.seq,
        partRevisions(before).at(-1)!.seq,
      ])
      expect(after.map((row) => row.seq)).toEqual([...after.map((row) => row.seq)].sort((a, b) => a - b))
      expect(after.length).toBeLessThan(before.length)

      // Two revisions each for the message and the session, and the part that
      // was only ever written once is left exactly as it was.
      expect(after.filter((row) => row.type === "message.updated.1")).toHaveLength(2)
      expect(after.filter((row) => row.type === "session.updated.1")).toHaveLength(2)
      expect(
        after.filter((row) => row.type === "message.part.updated.1" && (row.data as any).part.id === ids.other),
      ).toHaveLength(1)
    }),
  )

  it.effect("collapses a long revision chain to two rows and stays idempotent", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const { db } = yield* Database.Service
      const ids = yield* seed(events, db)
      const retention = yield* EventRetention.make(db, events.barrier, { aggregatesPerPass: 1_000 })

      for (let index = 0; index < 50; index++) {
        yield* events.publish(SessionLegacy.Event.PartUpdated, {
          sessionID: ids.sessionID,
          part: textPart(ids.sessionID, ids.messageID, ids.other, `chunk ${index}`),
          time: 8_000 + index,
        })
      }

      expect(yield* drain(retention)).toBeGreaterThan(50)
      const after = yield* journal(db, ids.sessionID)
      const revisions = after.filter(
        (row) => row.type === "message.part.updated.1" && (row.data as any).part.id === ids.other,
      )
      expect(revisions.map((row) => (row.data as any).part.text)).toEqual(["only", "chunk 49"])
      // A second run has nothing left to do.
      expect(yield* retention.compact()).toBe(0)
    }),
  )

  it.effect("never deletes created, deleted or removed events", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const { db } = yield* Database.Service
      const ids = yield* seed(events, db)
      const retention = yield* EventRetention.make(db, events.barrier, { aggregatesPerPass: 1_000 })

      yield* drain(retention)
      const after = yield* journal(db, ids.sessionID)

      expect(after.filter((row) => row.type === "session.created.1")).toHaveLength(1)
      expect(after.filter((row) => row.type === "message.part.removed.1")).toHaveLength(1)
      // The removed part's own revision is superseded by nothing, so it stays
      // put: replay still needs it to insert the row the removal deletes.
      expect(
        after.filter((row) => row.type === "message.part.updated.1" && (row.data as any).part.id === ids.removed),
      ).toHaveLength(1)
    }),
  )

  it.effect("replays the compacted journal to identical rows", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const { db } = yield* Database.Service
      const ids = yield* seed(events, db)
      const retention = yield* EventRetention.make(db, events.barrier, { aggregatesPerPass: 1_000 })

      const expected = yield* projection(db, ids.sessionID)
      yield* drain(retention)
      const compacted = yield* journal(db, ids.sessionID)

      // A pristine database replays the surviving stream from scratch, which is
      // exactly what session warp and /sync/history do on the far side.
      // `Layer.fresh` is what stops the memo map from handing back the layers
      // this test is already running on - the replay has to land on an empty
      // database to prove anything.
      const context = yield* Layer.build(
        Layer.fresh(SessionProjector.layer).pipe(
          Layer.provideMerge(Layer.fresh(EventV2.layer)),
          Layer.provideMerge(Layer.fresh(Database.layerFromPath(":memory:"))),
        ),
      )
      const target = Context.get(context, EventV2.Service)
      const replica = Context.get(context, Database.Service).db
      yield* project(replica, ids.projectID)
      yield* target.replayAll(
        compacted.map((row) => ({
          id: row.id,
          aggregateID: row.aggregate_id,
          seq: row.seq,
          type: row.type,
          data: row.data,
        })),
      )
      const actual = yield* projection(replica, ids.sessionID)

      expect(actual.sessions).toEqual(expected.sessions)
      // `time_updated` is a wall-clock column stamped by the writer, not
      // something the journal carries, so it is the one field a second replay
      // cannot reproduce.
      expect(actual.messages.map(withoutWriteStamp)).toEqual(expected.messages.map(withoutWriteStamp))
      expect(actual.parts.map(withoutWriteStamp)).toEqual(expected.parts.map(withoutWriteStamp))
      expect(actual.parts.map((row) => row.time_created)).toEqual(expected.parts.map((row) => row.time_created))
    }),
  )
})
