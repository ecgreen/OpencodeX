import { Context, Deferred, Effect, Layer, Schema, Scope } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { SessionID, MessageID } from "@/session/schema"
import * as Log from "@opencode-ai/core/util/log"
import { QuestionID } from "./schema"
import { EventV2Bridge } from "@/event-v2-bridge"
import { EventV2 } from "@opencode-ai/core/event"
import { Database } from "@opencode-ai/core/database/database"
import { SessionExecutionTable, SessionInteractionTable } from "@opencode-ai/core/session/sql"
import { and, eq } from "drizzle-orm"
import { SessionStatus } from "@/session/status"

const log = Log.create({ service: "question" })
const encodeQuestionID = Schema.encodeSync(QuestionID)

// Schemas — these are pure data; nothing checks class identity (see PR
// description) so they're plain `Schema.Struct` + type alias. That lets
// `Question.ask` and other internal sites trust the type contract without a
// re-decode to coerce nested class instances.

export const Option = Schema.Struct({
  label: Schema.String.annotate({
    description: "Display text (1-5 words, concise)",
  }),
  description: Schema.String.annotate({
    description: "Explanation of choice",
  }),
}).annotate({ identifier: "QuestionOption" })
export type Option = Schema.Schema.Type<typeof Option>

const base = {
  question: Schema.String.annotate({
    description: "Complete question",
  }),
  header: Schema.String.annotate({
    description: "Very short label (max 30 chars)",
  }),
  options: Schema.Array(Option).annotate({
    description: "Available choices",
  }),
  multiple: Schema.optional(Schema.Boolean).annotate({
    description: "Allow selecting multiple choices",
  }),
}

export const Info = Schema.Struct({
  ...base,
  custom: Schema.optional(Schema.Boolean).annotate({
    description: "Allow typing a custom answer (default: true)",
  }),
}).annotate({ identifier: "QuestionInfo" })
export type Info = Schema.Schema.Type<typeof Info>

export const Prompt = Schema.Struct(base).annotate({ identifier: "QuestionPrompt" })
export type Prompt = Schema.Schema.Type<typeof Prompt>

export const Tool = Schema.Struct({
  messageID: MessageID,
  callID: Schema.String,
}).annotate({ identifier: "QuestionTool" })
export type Tool = Schema.Schema.Type<typeof Tool>

export const Request = Schema.Struct({
  id: QuestionID,
  sessionID: SessionID,
  questions: Schema.Array(Info).annotate({
    description: "Questions to ask",
  }),
  tool: Schema.optional(Tool),
  executionGeneration: Schema.optional(Schema.Number),
}).annotate({ identifier: "QuestionRequest" })
export type Request = Schema.Schema.Type<typeof Request>

export const Answer = Schema.Array(Schema.String).annotate({ identifier: "QuestionAnswer" })
export type Answer = Schema.Schema.Type<typeof Answer>

export const Reply = Schema.Struct({
  answers: Schema.Array(Answer).annotate({
    description: "User answers in order of questions (each answer is an array of selected labels)",
  }),
}).annotate({ identifier: "QuestionReply" })
export type Reply = Schema.Schema.Type<typeof Reply>

const decodeRequest = Schema.decodeUnknownOption(Request)
const decodeReply = Schema.decodeUnknownOption(Reply)

function requestRecord(info: Request): Record<string, unknown> {
  return {
    id: info.id,
    sessionID: info.sessionID,
    questions: info.questions.map((question) => ({
      question: question.question,
      header: question.header,
      options: question.options.map((option) => ({ ...option })),
      multiple: question.multiple,
      custom: question.custom,
    })),
    tool: info.tool ? { ...info.tool } : undefined,
    executionGeneration: info.executionGeneration,
  }
}

export const Replied = Schema.Struct({
  sessionID: SessionID,
  requestID: QuestionID,
  answers: Schema.Array(Answer),
}).annotate({ identifier: "QuestionReplied" })

export const Rejected = Schema.Struct({
  sessionID: SessionID,
  requestID: QuestionID,
}).annotate({ identifier: "QuestionRejected" })

export const Event = {
  Asked: EventV2.define({ type: "question.asked", schema: Request.fields }),
  Replied: EventV2.define({ type: "question.replied", schema: Replied.fields }),
  Rejected: EventV2.define({ type: "question.rejected", schema: Rejected.fields }),
}

export class RejectedError extends Schema.TaggedErrorClass<RejectedError>()("QuestionRejectedError", {}) {
  override get message() {
    return "The user dismissed this question"
  }
}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("Question.NotFoundError", {
  requestID: QuestionID,
}) {}

interface PendingEntry {
  info: Request
  deferred: Deferred.Deferred<ReadonlyArray<Answer>, RejectedError>
}

interface State {
  pending: Map<QuestionID, PendingEntry>
}

// Service

export interface Interface {
  readonly ask: (input: {
    sessionID: SessionID
    questions: ReadonlyArray<Info>
    tool?: Tool
    executionGeneration?: number
  }) => Effect.Effect<ReadonlyArray<Answer>, RejectedError>
  readonly reply: (input: {
    requestID: QuestionID
    answers: ReadonlyArray<Answer>
  }) => Effect.Effect<void, NotFoundError>
  readonly reject: (requestID: QuestionID) => Effect.Effect<void, NotFoundError>
  readonly list: () => Effect.Effect<ReadonlyArray<Request>>
  readonly rejectForGeneration: (sessionID: SessionID, generation: number) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Question") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2Bridge.Service
    const { db } = yield* Database.Service
    const scope = yield* Scope.Scope

    const rejectPending = Effect.fn("Question.rejectPending")(function* (requestID: QuestionID, sessionID: SessionID) {
      const now = Date.now()
      const committed = yield* events.barrier(
        db
          .transaction(
            (transaction) =>
              Effect.gen(function* () {
                const updated = yield* transaction
                  .update(SessionInteractionTable)
                  .set({ state: "rejected", responded_at: now, time_updated: now })
                  .where(
                    and(
                      eq(SessionInteractionTable.id, encodeQuestionID(requestID)),
                      eq(SessionInteractionTable.kind, "question"),
                      eq(SessionInteractionTable.state, "pending"),
                    ),
                  )
                  .returning({ id: SessionInteractionTable.id })
                  .get()
                if (!updated) return
                return yield* events.commit(Event.Rejected, { sessionID, requestID })
              }),
            { behavior: "immediate" },
          )
          .pipe(Effect.orDie),
      )
      if (committed) yield* events.broadcast(committed)
    })

    const state = yield* InstanceState.make<State>(
      Effect.fn("Question.state")(function* () {
        const state = {
          pending: new Map<QuestionID, PendingEntry>(),
        }

        yield* Effect.addFinalizer(() =>
          Effect.gen(function* () {
            for (const item of state.pending.values()) {
              yield* Deferred.fail(item.deferred, new RejectedError())
              yield* rejectPending(item.info.id, item.info.sessionID)
            }
            state.pending.clear()
          }),
        )

        return state
      }),
    )

    const ask = Effect.fn("Question.ask")(function* (input: {
      sessionID: SessionID
      questions: ReadonlyArray<Info>
      tool?: Tool
      executionGeneration?: number
    }) {
      const pending = (yield* InstanceState.get(state)).pending
      const active = yield* SessionStatus.ExecutionGeneration
      const executionGeneration =
        input.executionGeneration ?? (active?.sessionID === input.sessionID ? active.generation : undefined)
      const id = QuestionID.ascending()
      log.info("asking", { id, questions: input.questions.length })

      const deferred = yield* Deferred.make<ReadonlyArray<Answer>, RejectedError>()
      const info: Request = {
        id,
        sessionID: input.sessionID,
        questions: input.questions,
        tool: input.tool,
        executionGeneration,
      }
      pending.set(id, { info, deferred })
      const ctx = yield* InstanceState.context
      return yield* Effect.gen(function* () {
        const now = Date.now()
        const asked = yield* events.barrier(
          db
            .transaction(
              (transaction) =>
                Effect.gen(function* () {
                  const execution = yield* transaction
                    .select({
                      cancelRequestedAt: SessionExecutionTable.cancel_requested_at,
                      generation: SessionExecutionTable.generation,
                    })
                    .from(SessionExecutionTable)
                    .where(eq(SessionExecutionTable.session_id, info.sessionID))
                    .get()
                  if (execution?.cancelRequestedAt) return
                  if (executionGeneration !== undefined && execution?.generation !== executionGeneration) return
                  yield* transaction
                    .insert(SessionInteractionTable)
                    .values([
                      {
                        id: encodeQuestionID(id),
                        kind: "question",
                        session_id: info.sessionID,
                        project_id: ctx.project.id,
                        directory: ctx.directory,
                        state: "pending",
                        request_json: requestRecord(info),
                        time_created: now,
                        time_updated: now,
                      },
                    ])
                    .run()
                  return yield* events.commit(Event.Asked, info)
                }),
              { behavior: "immediate" },
            )
            .pipe(Effect.orDie),
        )
        if (!asked) return yield* new RejectedError()
        yield* events.broadcast(asked)
        yield* observe(id, deferred).pipe(Effect.forkIn(scope))
        return yield* Deferred.await(deferred)
      }).pipe(
        Effect.onInterrupt(() => rejectPending(id, info.sessionID)),
        Effect.ensuring(
          Effect.sync(() => {
            pending.delete(id)
          }),
        ),
      )
    })

    const observe = Effect.fn("Question.observe")(function* (
      requestID: QuestionID,
      deferred: Deferred.Deferred<ReadonlyArray<Answer>, RejectedError>,
    ) {
      while (!(yield* Deferred.isDone(deferred))) {
        const row = yield* db
          .select({ state: SessionInteractionTable.state, response: SessionInteractionTable.response_json })
          .from(SessionInteractionTable)
          .where(
            and(
              eq(SessionInteractionTable.id, encodeQuestionID(requestID)),
              eq(SessionInteractionTable.kind, "question"),
            ),
          )
          .get()
          .pipe(Effect.orDie)
        if (!row || row.state === "rejected") {
          yield* Deferred.fail(deferred, new RejectedError()).pipe(Effect.asVoid)
          return
        }
        if (row.state === "replied") {
          const reply = decodeReply(row.response)
          if (reply._tag === "Some") yield* Deferred.succeed(deferred, reply.value.answers).pipe(Effect.asVoid)
          else yield* Deferred.fail(deferred, new RejectedError()).pipe(Effect.asVoid)
          return
        }
        yield* Effect.sleep("50 millis")
      }
    })

    const reply = Effect.fn("Question.reply")(function* (input: {
      requestID: QuestionID
      answers: ReadonlyArray<Answer>
    }) {
      const now = Date.now()
      const committed = yield* events.barrier(
        db
          .transaction(
            (transaction) =>
              Effect.gen(function* () {
                const existing = yield* transaction
                  .select()
                  .from(SessionInteractionTable)
                  .where(
                    and(
                      eq(SessionInteractionTable.id, encodeQuestionID(input.requestID)),
                      eq(SessionInteractionTable.kind, "question"),
                    ),
                  )
                  .get()
                if (!existing) return { found: false as const, event: undefined }
                if (existing.state !== "pending") return { found: true as const, event: undefined }
                const answers = input.answers.map((answer) => [...answer])
                const updated = yield* transaction
                  .update(SessionInteractionTable)
                  .set({
                    state: "replied",
                    response_json: { answers },
                    responded_at: now,
                    time_updated: now,
                  })
                  .where(
                    and(
                      eq(SessionInteractionTable.id, encodeQuestionID(input.requestID)),
                      eq(SessionInteractionTable.state, "pending"),
                    ),
                  )
                  .returning({ id: SessionInteractionTable.id })
                  .get()
                if (!updated) return { found: true as const, event: undefined }
                return {
                  found: true as const,
                  event: yield* events.commit(Event.Replied, {
                    sessionID: existing.session_id,
                    requestID: input.requestID,
                    answers,
                  }),
                }
              }),
            { behavior: "immediate" },
          )
          .pipe(Effect.orDie),
      )
      if (!committed.found) return yield* new NotFoundError({ requestID: input.requestID })
      if (committed.event) yield* events.broadcast(committed.event)
      log.info("replied", { requestID: input.requestID, answers: input.answers })
    })

    const reject = Effect.fn("Question.reject")(function* (requestID: QuestionID) {
      const now = Date.now()
      const committed = yield* events.barrier(
        db
          .transaction(
            (transaction) =>
              Effect.gen(function* () {
                const existing = yield* transaction
                  .select()
                  .from(SessionInteractionTable)
                  .where(
                    and(
                      eq(SessionInteractionTable.id, encodeQuestionID(requestID)),
                      eq(SessionInteractionTable.kind, "question"),
                    ),
                  )
                  .get()
                if (!existing) return { found: false as const, event: undefined }
                if (existing.state !== "pending") return { found: true as const, event: undefined }
                const updated = yield* transaction
                  .update(SessionInteractionTable)
                  .set({ state: "rejected", responded_at: now, time_updated: now })
                  .where(
                    and(
                      eq(SessionInteractionTable.id, encodeQuestionID(requestID)),
                      eq(SessionInteractionTable.state, "pending"),
                    ),
                  )
                  .returning({ id: SessionInteractionTable.id })
                  .get()
                if (!updated) return { found: true as const, event: undefined }
                return {
                  found: true as const,
                  event: yield* events.commit(Event.Rejected, { sessionID: existing.session_id, requestID }),
                }
              }),
            { behavior: "immediate" },
          )
          .pipe(Effect.orDie),
      )
      if (!committed.found) return yield* new NotFoundError({ requestID })
      if (committed.event) yield* events.broadcast(committed.event)
      log.info("rejected", { requestID })
    })

    const list = Effect.fn("Question.list")(function* () {
      const rows = yield* db
        .select({ request: SessionInteractionTable.request_json })
        .from(SessionInteractionTable)
        .where(and(eq(SessionInteractionTable.kind, "question"), eq(SessionInteractionTable.state, "pending")))
        .all()
        .pipe(Effect.orDie)
      return rows.flatMap((row) => {
        const request = decodeRequest(row.request)
        return request._tag === "Some" ? [request.value] : []
      })
    })

    const rejectForGeneration = Effect.fn("Question.rejectForGeneration")(function* (
      sessionID: SessionID,
      generation: number,
    ) {
      const now = Date.now()
      const committed = yield* events.barrier(
        db
          .transaction(
            (transaction) =>
              Effect.gen(function* () {
                const rows = yield* transaction
                  .select({ id: SessionInteractionTable.id, request: SessionInteractionTable.request_json })
                  .from(SessionInteractionTable)
                  .where(
                    and(
                      eq(SessionInteractionTable.kind, "question"),
                      eq(SessionInteractionTable.state, "pending"),
                      eq(SessionInteractionTable.session_id, sessionID),
                    ),
                  )
                  .all()
                const result: EventV2.Payload[] = []
                for (const row of rows) {
                  const request = decodeRequest(row.request)
                  if (
                    request._tag === "None" ||
                    (request.value.executionGeneration !== undefined &&
                      request.value.executionGeneration !== generation)
                  )
                    continue
                  const updated = yield* transaction
                    .update(SessionInteractionTable)
                    .set({ state: "rejected", responded_at: now, time_updated: now })
                    .where(and(eq(SessionInteractionTable.id, row.id), eq(SessionInteractionTable.state, "pending")))
                    .returning({ id: SessionInteractionTable.id })
                    .get()
                  if (!updated) continue
                  result.push(yield* events.commit(Event.Rejected, { sessionID, requestID: QuestionID.make(row.id) }))
                }
                return result
              }),
            { behavior: "immediate" },
          )
          .pipe(Effect.orDie),
      )
      yield* Effect.forEach(committed, events.broadcast, { discard: true })
    })

    return Service.of({ ask, reply, reject, list, rejectForGeneration })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Database.defaultLayer), Layer.provide(EventV2Bridge.defaultLayer))

export * as Question from "."
