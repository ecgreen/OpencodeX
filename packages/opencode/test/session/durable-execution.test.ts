import { expect } from "bun:test"
import { BackgroundJob } from "@/background/job"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Permission } from "@/permission"
import { PermissionID } from "@/permission/schema"
import { Question } from "@/question"
import { QuestionID } from "@/question/schema"
import { SessionRunState } from "@/session/run-state"
import { MessageID, SessionID } from "@/session/schema"
import { SessionStatus } from "@/session/status"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Database } from "@opencode-ai/core/database/database"
import { SessionLegacy } from "@opencode-ai/core/session/legacy"
import { ProviderV2 } from "@opencode-ai/core/provider"
import {
  PermissionTable,
  SessionExecutionTable,
  SessionInteractionTable,
  SessionStatusTable,
} from "@opencode-ai/core/session/sql"
import { and, eq } from "drizzle-orm"
import { Context, Effect, Exit, Fiber, Latch, Layer, Ref } from "effect"
import { pollWithTimeout, testEffect } from "../lib/effect"

const env = Layer.mergeAll(
  Database.defaultLayer,
  EventV2Bridge.defaultLayer,
  BackgroundJob.defaultLayer,
  CrossSpawnSpawner.defaultLayer,
)
const it = testEffect(env)

const sessionID = SessionID.make("ses_durable")
const output: SessionLegacy.WithParts = {
  info: {
    id: MessageID.make("msg_durable_assistant"),
    sessionID,
    role: "assistant",
    parentID: MessageID.make("msg_durable_user"),
    providerID: ProviderV2.ID.make("test"),
    modelID: ProviderV2.ModelID.make("test"),
    mode: "build",
    agent: "build",
    path: { cwd: ".", root: "." },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, completed: 2 },
    finish: "stop",
  },
  parts: [],
}

function eventRequestID(data: unknown) {
  return typeof data === "object" && data !== null && "requestID" in data ? String(data.requestID) : undefined
}

const buildRunGraph = Effect.fn("DurableExecutionTest.buildRunGraph")(function* () {
  const database = yield* Database.Service
  const events = yield* EventV2Bridge.Service
  const background = yield* BackgroundJob.Service
  const databaseLayer = Layer.succeed(Database.Service, database)
  const eventsLayer = Layer.succeed(EventV2Bridge.Service, events)
  const statusLayer = SessionStatus.layer.pipe(Layer.provide(databaseLayer), Layer.provide(eventsLayer))
  const runLayer = SessionRunState.layer.pipe(
    Layer.provide(Layer.succeed(BackgroundJob.Service, background)),
    Layer.provide(databaseLayer),
    Layer.provide(statusLayer),
  )
  const context = yield* Layer.build(Layer.fresh(Layer.mergeAll(runLayer, statusLayer)))
  return {
    run: Context.get(context, SessionRunState.Service),
    status: Context.get(context, SessionStatus.Service),
  }
})

const buildPermissionGraph = Effect.fn("DurableExecutionTest.buildPermissionGraph")(function* () {
  const database = yield* Database.Service
  const events = yield* EventV2Bridge.Service
  const context = yield* Layer.build(
    Layer.fresh(
      Permission.layer.pipe(
        Layer.provide(Layer.succeed(Database.Service, database)),
        Layer.provide(Layer.succeed(EventV2Bridge.Service, events)),
      ),
    ),
  )
  return Context.get(context, Permission.Service)
})

const buildQuestionGraph = Effect.fn("DurableExecutionTest.buildQuestionGraph")(function* () {
  const database = yield* Database.Service
  const events = yield* EventV2Bridge.Service
  const context = yield* Layer.build(
    Layer.fresh(
      Question.layer.pipe(
        Layer.provide(Layer.succeed(Database.Service, database)),
        Layer.provide(Layer.succeed(EventV2Bridge.Service, events)),
      ),
    ),
  )
  return Context.get(context, Question.Service)
})

it.instance("allows one lease winner and makes a foreign caller join", () =>
  Effect.gen(function* () {
    const first = yield* buildRunGraph()
    const second = yield* buildRunGraph()
    const started = yield* Ref.make(0)
    const release = yield* Latch.make()
    const work = Ref.update(started, (value) => value + 1).pipe(Effect.andThen(release.await), Effect.as(output))

    const a = yield* first.run.ensureRunning(sessionID, Effect.succeed(output), work).pipe(Effect.forkScoped)
    const b = yield* second.run.ensureRunning(sessionID, Effect.succeed(output), work).pipe(Effect.forkScoped)
    yield* pollWithTimeout(
      Ref.get(started).pipe(Effect.map((count) => (count === 1 ? true : undefined))),
      "multiple session executions started",
    )
    yield* release.open

    expect(yield* Effect.all([Fiber.join(a), Fiber.join(b)])).toHaveLength(2)
    expect(yield* Ref.get(started)).toBe(1)
  }),
)

it.instance("rejects stale status writes after a newer execution generation claims", () =>
  Effect.gen(function* () {
    const first = yield* buildRunGraph()
    const second = yield* buildRunGraph()
    const release = yield* Latch.make()
    const firstFiber = yield* first.run
      .ensureRunning(sessionID, Effect.succeed(output), Effect.never)
      .pipe(Effect.forkScoped)
    yield* pollWithTimeout(
      first.status.get(sessionID).pipe(Effect.map((status) => (status.type === "busy" ? true : undefined))),
      "first execution never became busy",
    )

    const { db } = yield* Database.Service
    yield* db
      .update(SessionExecutionTable)
      .set({ lease_expires_at: Date.now() - 1 })
      .where(eq(SessionExecutionTable.session_id, sessionID))
      .run()
      .pipe(Effect.orDie)
    const secondFiber = yield* second.run
      .ensureRunning(sessionID, Effect.succeed(output), release.await.pipe(Effect.as(output)))
      .pipe(Effect.forkScoped)
    yield* pollWithTimeout(
      db
        .select({ generation: SessionExecutionTable.generation })
        .from(SessionExecutionTable)
        .where(eq(SessionExecutionTable.session_id, sessionID))
        .get()
        .pipe(Effect.orDie, Effect.map((row) => (row?.generation === 2 ? true : undefined))),
      "new execution generation never claimed",
    )
    yield* Fiber.join(firstFiber)

    expect(yield* second.status.get(sessionID)).toEqual({ type: "busy" })
    expect(yield* second.status.setForGeneration(sessionID, 1, { type: "idle" })).toBe(false)
    expect(yield* second.status.get(sessionID)).toEqual({ type: "busy" })
    yield* release.open
    yield* Fiber.join(secondFiber)
  }),
)

it.instance("rejects active status writes after their execution generation releases", () =>
  Effect.gen(function* () {
    const graph = yield* buildRunGraph()
    yield* graph.run.ensureRunning(sessionID, Effect.succeed(output), Effect.succeed(output))

    expect(yield* graph.status.get(sessionID)).toEqual({ type: "idle" })
    expect(yield* graph.status.setForGeneration(sessionID, 1, { type: "busy" })).toBe(false)
    expect(
      yield* graph.status.setForGeneration(sessionID, 1, {
        type: "retry",
        attempt: 1,
        message: "stale",
        next: Date.now(),
      }),
    ).toBe(false)
    expect(yield* graph.status.get(sessionID)).toEqual({ type: "idle" })
  }),
)

it.instance("persists abort across graphs and interrupts the owner", () =>
  Effect.gen(function* () {
    const owner = yield* buildRunGraph()
    const remote = yield* buildRunGraph()
    const fiber = yield* owner.run
      .ensureRunning(sessionID, Effect.succeed(output), Effect.never)
      .pipe(Effect.forkScoped)
    yield* pollWithTimeout(
      owner.status.get(sessionID).pipe(Effect.map((status) => (status.type === "busy" ? true : undefined))),
      "session never became busy",
    )

    yield* remote.run.cancel(sessionID)
    expect(Exit.isSuccess(yield* Fiber.await(fiber))).toBe(true)

    const { db } = yield* Database.Service
    const execution = yield* db
      .select()
      .from(SessionExecutionTable)
      .where(eq(SessionExecutionTable.session_id, sessionID))
      .get()
      .pipe(Effect.orDie)
    expect(execution).toMatchObject({ state: "interrupted", owner_id: null })
    expect(yield* remote.status.get(sessionID)).toEqual({ type: "idle" })
  }),
)

it.instance("recovers a dead owner and stale busy status", () =>
  Effect.gen(function* () {
    const graph = yield* buildRunGraph()
    const { db } = yield* Database.Service
    const now = Date.now()
    yield* db
      .insert(SessionExecutionTable)
      .values({
        session_id: sessionID,
        project_id: "project",
        directory: process.cwd(),
        state: "running",
        owner_id: "local:999999:dead:graph",
        generation: 1,
        lease_expires_at: now + 60_000,
        time_created: now,
        time_updated: now,
      })
      .run()
      .pipe(Effect.orDie)
    yield* db
      .insert(SessionStatusTable)
      .values({
        session_id: sessionID,
        project_id: "project",
        directory: process.cwd(),
        status: { type: "busy" },
        time_created: now,
        time_updated: now,
      })
      .run()
      .pipe(Effect.orDie)

    expect(yield* graph.status.get(sessionID)).toEqual({ type: "idle" })
    expect(
      yield* db
        .select({ state: SessionExecutionTable.state })
        .from(SessionExecutionTable)
        .where(eq(SessionExecutionTable.session_id, sessionID))
        .get()
        .pipe(Effect.orDie),
    ).toEqual({ state: "interrupted" })
  }),
)

it.instance("shares permission requests, replies once, and persists always grants", () =>
  Effect.gen(function* () {
    const first = yield* buildPermissionGraph()
    const second = yield* buildPermissionGraph()
    const events = yield* EventV2Bridge.Service
    const replies = yield* Ref.make(0)
    const requestID = PermissionID.make("per_durable")
    const unsubscribe = yield* events.listen((event) =>
      event.type === Permission.Event.Replied.type && eventRequestID(event.data) === String(requestID)
        ? Ref.update(replies, (count) => count + 1)
        : Effect.void,
    )
    yield* Effect.addFinalizer(() => unsubscribe)
    const ask = yield* first
      .ask({
        id: requestID,
        sessionID,
        permission: "bash",
        patterns: ["ls"],
        metadata: {},
        always: ["ls"],
        ruleset: [],
      })
      .pipe(Effect.forkScoped)
    yield* pollWithTimeout(
      second.list().pipe(Effect.map((items) => (items.some((item) => item.id === requestID) ? true : undefined))),
      "permission was not visible across graphs",
    )

    yield* Effect.all([
      first.reply({ requestID, reply: "always" }),
      second.reply({ requestID, reply: "reject" }),
    ])
    yield* Fiber.await(ask)
    expect(yield* Ref.get(replies)).toBe(1)

    const { db } = yield* Database.Service
    const interaction = yield* db
      .select()
      .from(SessionInteractionTable)
      .where(eq(SessionInteractionTable.id, String(requestID)))
      .get()
      .pipe(Effect.orDie)
    expect(interaction?.state).toMatch(/replied|rejected/)
    expect(yield* second.list()).toHaveLength(0)

    const alwaysID = PermissionID.make("per_durable_always")
    const alwaysAsk = yield* first
      .ask({
        id: alwaysID,
        sessionID,
        permission: "bash",
        patterns: ["pwd"],
        metadata: {},
        always: ["pwd"],
        ruleset: [],
      })
      .pipe(Effect.forkScoped)
    yield* pollWithTimeout(
      second.list().pipe(Effect.map((items) => (items.some((item) => item.id === alwaysID) ? true : undefined))),
      "always permission was not visible across graphs",
    )
    yield* second.reply({ requestID: alwaysID, reply: "always" })
    yield* Fiber.join(alwaysAsk)

    const project = yield* db
      .select({ projectID: SessionInteractionTable.project_id })
      .from(SessionInteractionTable)
      .where(eq(SessionInteractionTable.id, String(alwaysID)))
      .get()
      .pipe(Effect.orDie)
    const grants = project
      ? yield* db
          .select({ data: PermissionTable.data })
          .from(PermissionTable)
          .where(eq(PermissionTable.project_id, project.projectID))
          .get()
          .pipe(Effect.orDie)
      : undefined
    expect(grants?.data).toContainEqual({ permission: "bash", pattern: "pwd", action: "allow" })
    expect(
      yield* second.ask({
        sessionID,
        permission: "bash",
        patterns: ["pwd"],
        metadata: {},
        always: [],
        ruleset: [],
      }),
    ).toBeUndefined()
  }),
)

it.instance("shares questions and settles the owning Deferred from a remote reply", () =>
  Effect.gen(function* () {
    const first = yield* buildQuestionGraph()
    const second = yield* buildQuestionGraph()
    const events = yield* EventV2Bridge.Service
    const replies = yield* Ref.make(0)
    const ask = yield* first
      .ask({
        sessionID,
        questions: [
          {
            question: "Continue?",
            header: "Continue",
            options: [{ label: "Yes", description: "Continue" }],
          },
        ],
      })
      .pipe(Effect.forkScoped)
    const pending = yield* pollWithTimeout(
      second.list().pipe(Effect.map((items) => items[0])),
      "question was not visible across graphs",
    )
    const unsubscribe = yield* events.listen((event) =>
      (event.type === Question.Event.Replied.type || event.type === Question.Event.Rejected.type) &&
      eventRequestID(event.data) === String(pending.id)
        ? Ref.update(replies, (count) => count + 1)
        : Effect.void,
    )
    yield* Effect.addFinalizer(() => unsubscribe)
    yield* Effect.all([
      first.reply({ requestID: pending.id, answers: [["Yes"]] }),
      second.reject(pending.id),
    ])
    const exit = yield* Fiber.await(ask)
    expect(Exit.isSuccess(exit) ? exit.value : exit.cause).toBeDefined()
    expect(yield* Ref.get(replies)).toBe(1)
    expect(yield* second.list()).toHaveLength(0)

    const { db } = yield* Database.Service
    expect(
      yield* db
        .select({ state: SessionInteractionTable.state })
        .from(SessionInteractionTable)
        .where(
          and(
            eq(SessionInteractionTable.id, String(QuestionID.make(String(pending.id)))),
            eq(SessionInteractionTable.kind, "question"),
          ),
        )
        .get()
        .pipe(Effect.orDie),
    ).toMatchObject({ state: expect.stringMatching(/replied|rejected/) })
  }),
)
