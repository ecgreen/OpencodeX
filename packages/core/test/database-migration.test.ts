import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import { fileURLToPath } from "url"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import { Effect } from "effect"
import { sql } from "drizzle-orm"
import { DatabaseMigration } from "@opencode-ai/core/database/migration"
import sessionUsageMigration from "@opencode-ai/core/database/migration/20260510033149_session_usage"
import { migrations } from "@opencode-ai/core/database/migration.gen"
import type { SqlClient as SqlClientService } from "effect/unstable/sql/SqlClient"

const run = <A, E>(effect: Effect.Effect<A, E, SqlClientService>) =>
  Effect.runPromise(
    effect.pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:", disableWAL: true })), Effect.scoped),
  )

const makeDb = EffectDrizzleSqlite.makeWithDefaults()

describe("DatabaseMigration", () => {
  if (process.platform === "linux") {
    test("declared schema has no ungenerated migrations", async () => {
      const result = await $`bun ${fileURLToPath(new URL("../script/migration.ts", import.meta.url))} --check`
        .quiet()
        .nothrow()
      expect(result.exitCode, result.stderr.toString()).toBe(0)
      expect(result.stdout.toString()).toContain("No schema changes, nothing to migrate")
    }, 30_000)
  }

  test("applies tracked migrations to an empty database", async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* makeDb
        yield* DatabaseMigration.apply(db)

        expect(yield* db.get(sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'session'`)).toEqual({
          name: "session",
        })
        expect(yield* db.get(sql`SELECT count(*) as count FROM migration`)).toEqual({ count: 37 })
        expect(
          yield* db.get(
            sql`SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'session_time_updated_id_idx'`,
          ),
        ).toEqual({ name: "session_time_updated_id_idx" })
        const plan = yield* db.all<{ detail: unknown }>(sql`
          EXPLAIN QUERY PLAN
          SELECT id FROM session
          WHERE time_updated < 100 OR (time_updated = 100 AND id < 'ses_cursor')
          ORDER BY time_updated DESC, id DESC
          LIMIT 201
        `)
        expect(plan.some((row) => String(row.detail).includes("session_time_updated_id_idx"))).toBe(true)
      }),
    )
  })

  test("runs session usage backfill in order with schema changes", async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* makeDb
        yield* db.run(sql`CREATE TABLE session (id text PRIMARY KEY, time_updated integer NOT NULL)`)
        yield* db.run(sql`CREATE TABLE message (id text PRIMARY KEY, session_id text NOT NULL, data text NOT NULL)`)
        yield* db.run(sql`INSERT INTO session (id, time_updated) VALUES ('session_1', 1)`)
        yield* db.run(
          sql`INSERT INTO message (id, session_id, data) VALUES ('message_1', 'session_1', '{"role":"assistant","cost":1.25,"tokens":{"input":2,"output":3,"reasoning":4,"cache":{"read":5,"write":6}}}')`,
        )

        yield* DatabaseMigration.applyOnly(db, [sessionUsageMigration])

        expect(
          yield* db.get(
            sql`SELECT cost, tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write FROM session WHERE id = 'session_1'`,
          ),
        ).toEqual({
          cost: 1.25,
          tokens_input: 2,
          tokens_output: 3,
          tokens_reasoning: 4,
          tokens_cache_read: 5,
          tokens_cache_write: 6,
        })
      }),
    )
  })

  test("imports existing drizzle migration state", async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* makeDb
        yield* db.run(
          sql`CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash text NOT NULL, created_at numeric, name text, applied_at TEXT)`,
        )
        yield* db.run(sql`
          INSERT INTO __drizzle_migrations (hash, created_at, name, applied_at)
          VALUES ('hash', 1, '20260127222353_familiar_lady_ursula', ${new Date().toISOString()})
        `)

        yield* DatabaseMigration.applyOnly(db, [])

        expect(yield* db.get(sql`SELECT id FROM migration`)).toEqual({ id: "20260127222353_familiar_lady_ursula" })
      }),
    )
  })

  test("upgrades an upstream database with a drizzle migration journal", async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* makeDb
        const firstOpencodeXMigration = migrations.findIndex(
          (migration) => migration.id === "20260601000000_opencodex_project_folder",
        )
        yield* DatabaseMigration.applyOnly(db, migrations.slice(0, firstOpencodeXMigration))
        const completed = yield* db.all<{ id: string }>(sql`SELECT id FROM migration`)
        yield* db.run(sql`DROP TABLE migration`)
        yield* db.run(
          sql`CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash text NOT NULL, created_at numeric, name text, applied_at TEXT)`,
        )
        yield* Effect.forEach(
          completed,
          (migration) =>
            db.run(sql`
              INSERT INTO __drizzle_migrations (hash, created_at, name, applied_at)
              VALUES (${migration.id}, 1, ${migration.id}, ${new Date().toISOString()})
            `),
          { discard: true },
        )

        yield* DatabaseMigration.apply(db)

        expect(yield* db.get(sql`SELECT count(*) as count FROM migration`)).toEqual({ count: migrations.length })
        expect(
          yield* db.get(
            sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'opencodex_state_aggregate_sequence'`,
          ),
        ).toEqual({ name: "opencodex_state_aggregate_sequence" })
      }),
    )
  })

  test("upgrades an existing OpencodeX database through reconciliation", async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* makeDb
        const coherenceMigration = migrations.findIndex(
          (migration) => migration.id === "20260720000000_opencodex_state_coherence",
        )
        yield* DatabaseMigration.applyOnly(db, migrations.slice(0, coherenceMigration))
        yield* db.run(sql`
          INSERT INTO opencodex_state_event
            (id, project_id, workspace_id, directory, aggregate_id, aggregate_sequence, domain, event_type, operation, payload, created_at)
          VALUES ('evt_1', 'project_1', NULL, '/project', 'aggregate_1', 3, 'session', 'updated', 'update', '{}', 1)
        `)

        yield* DatabaseMigration.apply(db)

        expect(yield* db.get(sql`SELECT count(*) as count FROM migration`)).toEqual({ count: migrations.length })
        expect(
          yield* db.get(sql`
            SELECT visibility, aggregate_sequence
            FROM opencodex_state_aggregate_sequence
            WHERE aggregate_id = 'aggregate_1'
          `),
        ).toEqual({ visibility: "instance", aggregate_sequence: 3 })
        expect(yield* db.get(sql`SELECT visibility FROM opencodex_state_event WHERE id = 'evt_1'`)).toEqual({
          visibility: "instance",
        })
      }),
    )
  })

  test("skips drizzle import when migration table already has state", async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* makeDb
        yield* db.run(sql`CREATE TABLE migration (id TEXT PRIMARY KEY, time_completed INTEGER NOT NULL)`)
        yield* db.run(sql`INSERT INTO migration (id, time_completed) VALUES ('existing', 1)`)
        yield* db.run(
          sql`CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash text NOT NULL, created_at numeric, name text, applied_at TEXT)`,
        )
        yield* db.run(sql`
          INSERT INTO __drizzle_migrations (hash, created_at, name, applied_at)
          VALUES ('hash', 1, '20260127222353_familiar_lady_ursula', ${new Date().toISOString()})
        `)

        yield* DatabaseMigration.applyOnly(db, [])

        expect(yield* db.all(sql`SELECT id FROM migration ORDER BY id`)).toEqual([{ id: "existing" }])
      }),
    )
  })
})
