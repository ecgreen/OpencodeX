import { afterEach, describe, expect } from "bun:test"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Database } from "@opencode-ai/core/database/database"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { OpencodeXProjectSessionTable } from "@opencode-ai/core/opencodex/sql"
import { eq } from "drizzle-orm"
import { Effect, Layer } from "effect"
import { EventV2Bridge } from "@/event-v2-bridge"
import { OpencodeXProject } from "@/opencodex/project"
import { Project } from "@/project/project"
import { SessionID } from "@/session/schema"
import { Session } from "@/session/session"
import { resetDatabase } from "../fixture/db"
import { testInstanceStoreLayer, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const dependencies = Layer.mergeAll(
  AppFileSystem.defaultLayer,
  CrossSpawnSpawner.defaultLayer,
  Database.defaultLayer,
  EventV2Bridge.defaultLayer,
  Project.defaultLayer,
  Session.defaultLayer,
  testInstanceStoreLayer,
)
const it = testEffect(OpencodeXProject.layer.pipe(Layer.provideMerge(dependencies)))

afterEach(resetDatabase)

describe("OpencodeXProject", () => {
  it.live("serializes concurrent partial project updates", () =>
    Effect.gen(function* () {
      const original = yield* tmpdirScoped({ git: true })
      const replacement = yield* tmpdirScoped({ git: true })
      const projects = yield* OpencodeXProject.Service
      const created = yield* projects.create({ name: "before", folders: [original] })

      yield* Effect.all(
        [
          projects.update({ projectID: created.id, folders: [replacement] }),
          projects.update({ projectID: created.id, name: "after" }),
        ],
        { concurrency: "unbounded" },
      )

      const result = yield* projects.get(created.id)
      expect(result.name).toBe("after")
      expect(result.folders).toEqual([{ path: replacement }])
    }),
  )

  it.live("creates an explicit session idempotently under concurrency", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped({ git: true })
      const projects = yield* OpencodeXProject.Service
      const project = yield* projects.create({ folders: [directory] })
      const sessionID = SessionID.make("ses_opencodex_idempotent")
      const created = yield* Effect.all(
        Array.from({ length: 20 }, () =>
          projects.createSession({ projectID: project.id, directory, sessionID }),
        ),
        { concurrency: "unbounded" },
      )

      expect(new Set(created.map((item) => item.id))).toEqual(new Set([sessionID]))
      const { db } = yield* Database.Service
      const assignments = yield* db
        .select()
        .from(OpencodeXProjectSessionTable)
        .where(eq(OpencodeXProjectSessionTable.session_id, sessionID))
        .all()
        .pipe(Effect.orDie)
      expect(assignments).toHaveLength(1)
      expect(assignments[0]?.opencodex_project_id).toBe(project.id)
    }),
  )

  it.live("keeps session metadata and project membership coherent during concurrent moves", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped({ git: true })
      const projects = yield* OpencodeXProject.Service
      const sessions = yield* Session.Service
      const left = yield* projects.create({ name: "left", folders: [directory] })
      const right = yield* projects.create({ name: "right", folders: [directory] })
      const session = yield* projects.createSession({ projectID: left.id, directory })

      yield* Effect.all(
        Array.from({ length: 20 }, (_, index) =>
          projects.moveSession({ projectID: index % 2 === 0 ? left.id : right.id, sessionID: session.id }),
        ),
        { concurrency: "unbounded" },
      )

      const { db } = yield* Database.Service
      const assignment = yield* db
        .select()
        .from(OpencodeXProjectSessionTable)
        .where(eq(OpencodeXProjectSessionTable.session_id, session.id))
        .get()
        .pipe(Effect.orDie)
      const current = yield* sessions.get(session.id)
      const metadata = current.metadata?.opencodex
      expect(metadata && typeof metadata === "object" && "projectID" in metadata ? metadata.projectID : undefined).toBe(
        assignment?.opencodex_project_id,
      )
    }),
  )
})
