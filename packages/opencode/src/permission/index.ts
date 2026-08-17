import { ConfigPermission } from "@/config/permission"
import { InstanceState } from "@/effect/instance-state"
import { ProjectV2 } from "@opencode-ai/core/project"
import { MessageID, SessionID } from "@/session/schema"
import { PermissionTable, SessionExecutionTable, SessionInteractionTable } from "@opencode-ai/core/session/sql"
import { Database } from "@opencode-ai/core/database/database"
import { and, eq } from "drizzle-orm"
import * as Log from "@opencode-ai/core/util/log"
import { Wildcard } from "@opencode-ai/core/util/wildcard"
import { Context, Deferred, Effect, Layer, Option, Schema, Scope } from "effect"
import os from "os"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { PermissionID } from "./schema"
import { EventV2Bridge } from "@/event-v2-bridge"
import { EventV2 } from "@opencode-ai/core/event"
import { SessionStatus } from "@/session/status"

const log = Log.create({ service: "permission" })
const encodePermissionID = Schema.encodeSync(PermissionID)

export const Action = PermissionV2.Action.annotate({ identifier: "PermissionAction" })
export type Action = Schema.Schema.Type<typeof Action>

export const Rule = Schema.Struct({
  permission: Schema.String,
  pattern: Schema.String,
  action: Action,
}).annotate({ identifier: "PermissionRule" })
export type Rule = Schema.Schema.Type<typeof Rule>

export const Ruleset = Schema.Array(Rule).annotate({ identifier: "PermissionRuleset" })
export type Ruleset = Schema.Schema.Type<typeof Ruleset>

// Pure data; nothing checks class identity. As `Schema.Struct` + type alias,
// `Permission.ask` can trust its already-typed input and skip the inner
// `decodeUnknownSync` that would otherwise throw uncaught on any structural
// mismatch. Same pattern as `Question.Request` in PR #28570.
export const Request = Schema.Struct({
  id: PermissionID,
  sessionID: SessionID,
  permission: Schema.String,
  patterns: Schema.Array(Schema.String),
  metadata: Schema.Record(Schema.String, Schema.Unknown),
  always: Schema.Array(Schema.String),
  executionGeneration: Schema.optional(Schema.Number),
  tool: Schema.optional(
    Schema.Struct({
      messageID: MessageID,
      callID: Schema.String,
    }),
  ),
}).annotate({ identifier: "PermissionRequest" })
export type Request = Schema.Schema.Type<typeof Request>

export const Reply = Schema.Literals(["once", "always", "reject"])
export type Reply = Schema.Schema.Type<typeof Reply>

const reply = {
  reply: Reply,
  message: Schema.optional(Schema.String),
}

export const ReplyBody = Schema.Struct(reply).annotate({ identifier: "PermissionReplyBody" })
export type ReplyBody = Schema.Schema.Type<typeof ReplyBody>

const decodeRequest = Schema.decodeUnknownOption(Request)
const decodeReply = Schema.decodeUnknownOption(ReplyBody)

function requestRecord(info: Request): Record<string, unknown> {
  return {
    id: info.id,
    sessionID: info.sessionID,
    permission: info.permission,
    patterns: [...info.patterns],
    metadata: { ...info.metadata },
    always: [...info.always],
    executionGeneration: info.executionGeneration,
    tool: info.tool ? { ...info.tool } : undefined,
  }
}

export const Approval = Schema.Struct({
  projectID: ProjectV2.ID,
  patterns: Schema.Array(Schema.String),
}).annotate({ identifier: "PermissionApproval" })
export type Approval = Schema.Schema.Type<typeof Approval>

export const Event = {
  Asked: EventV2.define({ type: "permission.asked", schema: Request.fields }),
  Replied: EventV2.define({
    type: "permission.replied",
    schema: {
      sessionID: SessionID,
      requestID: PermissionID,
      reply: Reply,
    },
  }),
}

export class RejectedError extends Schema.TaggedErrorClass<RejectedError>()("PermissionRejectedError", {}) {
  override get message() {
    return "The user rejected permission to use this specific tool call."
  }
}

export class CorrectedError extends Schema.TaggedErrorClass<CorrectedError>()("PermissionCorrectedError", {
  feedback: Schema.String,
}) {
  override get message() {
    return `The user rejected permission to use this specific tool call with the following feedback: ${this.feedback}`
  }
}

export class DeniedError extends Schema.TaggedErrorClass<DeniedError>()("PermissionDeniedError", {
  ruleset: Schema.Any,
}) {
  override get message() {
    return `The user has specified a rule which prevents you from using this specific tool call. Here are some of the relevant rules ${JSON.stringify(this.ruleset)}`
  }
}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("Permission.NotFoundError", {
  requestID: PermissionID,
}) {}

export type Error = DeniedError | RejectedError | CorrectedError

export const AskInput = Schema.Struct({
  ...Request.fields,
  id: Schema.optional(PermissionID),
  ruleset: Ruleset,
}).annotate({ identifier: "PermissionAskInput" })
export type AskInput = Schema.Schema.Type<typeof AskInput>

export const ReplyInput = Schema.Struct({
  requestID: PermissionID,
  ...reply,
}).annotate({ identifier: "PermissionReplyInput" })
export type ReplyInput = Schema.Schema.Type<typeof ReplyInput>

export interface Interface {
  readonly ask: (input: AskInput) => Effect.Effect<void, Error>
  readonly reply: (input: ReplyInput) => Effect.Effect<void, NotFoundError>
  readonly list: () => Effect.Effect<ReadonlyArray<Request>>
  readonly rejectForGeneration: (sessionID: SessionID, generation: number) => Effect.Effect<void>
}

interface PendingEntry {
  info: Request
  deferred: Deferred.Deferred<void, RejectedError | CorrectedError>
}

interface State {
  pending: Map<PermissionID, PendingEntry>
}

export function evaluate(permission: string, pattern: string, ...rulesets: Ruleset[]): Rule {
  return PermissionV2.evaluate(permission, pattern, ...rulesets)
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Permission") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2Bridge.Service
    const { db } = yield* Database.Service
    const scope = yield* Scope.Scope

    const rejectPending = Effect.fn("Permission.rejectPending")(function* (
      requestID: PermissionID,
      sessionID: SessionID,
    ) {
      const now = Date.now()
      const committed = yield* events.barrier(
        db
          .transaction(
            (transaction) =>
              Effect.gen(function* () {
                const updated = yield* transaction
                  .update(SessionInteractionTable)
                  .set({
                    state: "rejected",
                    response_json: { reply: "reject" },
                    responded_at: now,
                    time_updated: now,
                  })
                  .where(
                    and(
                      eq(SessionInteractionTable.id, encodePermissionID(requestID)),
                      eq(SessionInteractionTable.kind, "permission"),
                      eq(SessionInteractionTable.state, "pending"),
                    ),
                  )
                  .returning({ id: SessionInteractionTable.id })
                  .get()
                if (!updated) return
                return yield* events.commit(Event.Replied, { sessionID, requestID, reply: "reject" })
              }),
            { behavior: "immediate" },
          )
          .pipe(Effect.orDie),
      )
      if (committed) yield* events.broadcast(committed)
    })

    const state = yield* InstanceState.make<State>(
      Effect.fn("Permission.state")(function* () {
        const state = {
          pending: new Map<PermissionID, PendingEntry>(),
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

    const ask = Effect.fn("Permission.ask")(function* (input: AskInput) {
      const pending = (yield* InstanceState.get(state)).pending
      const active = yield* SessionStatus.ExecutionGeneration
      const executionGeneration =
        input.executionGeneration ?? (active?.sessionID === input.sessionID ? active.generation : undefined)
      const { ruleset, ...request } = input
      const ctx = yield* InstanceState.context
      if (executionGeneration !== undefined) {
        const valid = yield* db
          .transaction(
            (transaction) =>
              transaction
                .select({
                  cancelRequestedAt: SessionExecutionTable.cancel_requested_at,
                  generation: SessionExecutionTable.generation,
                })
                .from(SessionExecutionTable)
                .where(eq(SessionExecutionTable.session_id, request.sessionID))
                .get()
                .pipe(
                  Effect.map(
                    (execution) => execution?.generation === executionGeneration && !execution.cancelRequestedAt,
                  ),
                ),
            { behavior: "immediate" },
          )
          .pipe(Effect.orDie)
        if (!valid) return yield* new RejectedError()
      }
      const row = yield* db
        .select({ data: PermissionTable.data })
        .from(PermissionTable)
        .where(eq(PermissionTable.project_id, ctx.project.id))
        .get()
        .pipe(Effect.orDie)
      const approved = row?.data ?? []
      let needsAsk = false

      for (const pattern of request.patterns) {
        const rule = evaluate(request.permission, pattern, ruleset, approved)
        log.info("evaluated", { permission: request.permission, pattern, action: rule })
        if (rule.action === "deny") {
          return yield* new DeniedError({
            ruleset: ruleset.filter((rule) => Wildcard.match(request.permission, rule.permission)),
          })
        }
        if (rule.action === "allow") continue
        needsAsk = true
      }

      if (!needsAsk) return

      const id = request.id ?? PermissionID.ascending()
      const info: Request = {
        id,
        sessionID: request.sessionID,
        permission: request.permission,
        patterns: request.patterns,
        metadata: request.metadata,
        always: request.always,
        tool: request.tool,
        executionGeneration,
      }
      log.info("asking", { id, permission: info.permission, patterns: info.patterns })

      const deferred = yield* Deferred.make<void, RejectedError | CorrectedError>()
      pending.set(id, { info, deferred })
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
                        id: encodePermissionID(id),
                        kind: "permission",
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

    const observe = Effect.fn("Permission.observe")(function* (
      requestID: PermissionID,
      deferred: Deferred.Deferred<void, RejectedError | CorrectedError>,
    ) {
      while (!(yield* Deferred.isDone(deferred))) {
        const row = yield* db
          .select({ state: SessionInteractionTable.state, response: SessionInteractionTable.response_json })
          .from(SessionInteractionTable)
          .where(
            and(
              eq(SessionInteractionTable.id, encodePermissionID(requestID)),
              eq(SessionInteractionTable.kind, "permission"),
            ),
          )
          .get()
          .pipe(Effect.orDie)
        if (!row) {
          yield* Deferred.fail(deferred, new RejectedError()).pipe(Effect.asVoid)
          return
        }
        if (row.state === "pending") {
          yield* Effect.sleep("50 millis")
          continue
        }
        const response = Option.getOrUndefined(decodeReply(row.response))
        if (!response || response.reply === "reject") {
          yield* Deferred.fail(
            deferred,
            response?.message ? new CorrectedError({ feedback: response.message }) : new RejectedError(),
          ).pipe(Effect.asVoid)
          return
        }
        yield* Deferred.succeed(deferred, undefined).pipe(Effect.asVoid)
        return
      }
    })

    const reply = Effect.fn("Permission.reply")(function* (input: ReplyInput) {
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
                      eq(SessionInteractionTable.id, encodePermissionID(input.requestID)),
                      eq(SessionInteractionTable.kind, "permission"),
                    ),
                  )
                  .get()
                if (!existing) return { found: false as const, events: [] }
                if (existing.state !== "pending") return { found: true as const, events: [] }
                const request = Option.getOrUndefined(decodeRequest(existing.request_json))
                if (!request)
                  return yield* Effect.die(
                    new Error(`Invalid permission request ${encodePermissionID(input.requestID)}`),
                  )

                const permissionRow = yield* transaction
                  .select({ data: PermissionTable.data })
                  .from(PermissionTable)
                  .where(eq(PermissionTable.project_id, existing.project_id))
                  .get()
                const approved = [...(permissionRow?.data ?? [])]
                if (input.reply === "always") {
                  approved.push(
                    ...request.always.map((pattern) => ({
                      permission: request.permission,
                      pattern,
                      action: "allow" as const,
                    })),
                  )
                  yield* transaction
                    .insert(PermissionTable)
                    .values({
                      project_id: existing.project_id,
                      data: approved,
                      time_created: now,
                      time_updated: now,
                    })
                    .onConflictDoUpdate({
                      target: PermissionTable.project_id,
                      set: { data: approved, time_updated: now },
                    })
                    .run()
                }

                const candidates =
                  input.reply === "once"
                    ? [existing]
                    : yield* transaction
                        .select()
                        .from(SessionInteractionTable)
                        .where(
                          and(
                            eq(SessionInteractionTable.kind, "permission"),
                            eq(SessionInteractionTable.state, "pending"),
                            eq(SessionInteractionTable.session_id, existing.session_id),
                          ),
                        )
                        .all()
                const selected: Array<{ row: (typeof candidates)[number]; item: Request; reply: Reply }> = []
                for (const row of candidates) {
                  const item = Option.getOrUndefined(decodeRequest(row.request_json))
                  if (!item) continue
                  if (input.reply === "reject") {
                    selected.push({ row, item, reply: "reject" })
                    continue
                  }
                  if (row.id === encodePermissionID(input.requestID)) {
                    selected.push({ row, item, reply: input.reply })
                    continue
                  }
                  const allowed = item.patterns.every(
                    (pattern) => evaluate(item.permission, pattern, approved).action === "allow",
                  )
                  if (allowed) selected.push({ row, item, reply: "always" })
                }
                const result: EventV2.Payload[] = []
                for (const item of selected) {
                  const updated = yield* transaction
                    .update(SessionInteractionTable)
                    .set({
                      state: item.reply === "reject" ? "rejected" : "replied",
                      response_json: {
                        reply: item.reply,
                        ...(item.row.id === encodePermissionID(input.requestID) && input.message
                          ? { message: input.message }
                          : {}),
                      },
                      responded_at: now,
                      time_updated: now,
                    })
                    .where(
                      and(eq(SessionInteractionTable.id, item.row.id), eq(SessionInteractionTable.state, "pending")),
                    )
                    .returning({ id: SessionInteractionTable.id })
                    .get()
                  if (!updated) continue
                  result.push(
                    yield* events.commit(Event.Replied, {
                      sessionID: item.item.sessionID,
                      requestID: PermissionID.make(item.row.id),
                      reply: item.reply,
                    }),
                  )
                }
                return { found: true as const, events: result }
              }),
            { behavior: "immediate" },
          )
          .pipe(Effect.orDie),
      )
      if (!committed.found) return yield* new NotFoundError({ requestID: input.requestID })
      yield* Effect.forEach(committed.events, events.broadcast, { discard: true })
    })

    const list = Effect.fn("Permission.list")(function* () {
      const rows = yield* db
        .select({ request: SessionInteractionTable.request_json })
        .from(SessionInteractionTable)
        .where(and(eq(SessionInteractionTable.kind, "permission"), eq(SessionInteractionTable.state, "pending")))
        .all()
        .pipe(Effect.orDie)
      return rows.flatMap((row) => {
        const request = Option.getOrUndefined(decodeRequest(row.request))
        return request ? [request] : []
      })
    })

    const rejectForGeneration = Effect.fn("Permission.rejectForGeneration")(function* (
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
                      eq(SessionInteractionTable.kind, "permission"),
                      eq(SessionInteractionTable.state, "pending"),
                      eq(SessionInteractionTable.session_id, sessionID),
                    ),
                  )
                  .all()
                const result: EventV2.Payload[] = []
                for (const row of rows) {
                  const request = Option.getOrUndefined(decodeRequest(row.request))
                  if (
                    !request ||
                    (request.executionGeneration !== undefined && request.executionGeneration !== generation)
                  )
                    continue
                  const updated = yield* transaction
                    .update(SessionInteractionTable)
                    .set({
                      state: "rejected",
                      response_json: { reply: "reject" },
                      responded_at: now,
                      time_updated: now,
                    })
                    .where(and(eq(SessionInteractionTable.id, row.id), eq(SessionInteractionTable.state, "pending")))
                    .returning({ id: SessionInteractionTable.id })
                    .get()
                  if (!updated) continue
                  result.push(
                    yield* events.commit(Event.Replied, {
                      sessionID,
                      requestID: PermissionID.make(row.id),
                      reply: "reject",
                    }),
                  )
                }
                return result
              }),
            { behavior: "immediate" },
          )
          .pipe(Effect.orDie),
      )
      yield* Effect.forEach(committed, events.broadcast, { discard: true })
    })

    return Service.of({ ask, reply, list, rejectForGeneration })
  }),
)

function expand(pattern: string): string {
  if (pattern.startsWith("~/")) return os.homedir() + pattern.slice(1)
  if (pattern === "~") return os.homedir()
  if (pattern.startsWith("$HOME/")) return os.homedir() + pattern.slice(5)
  if (pattern.startsWith("$HOME")) return os.homedir() + pattern.slice(5)
  return pattern
}

export function fromConfig(permission: ConfigPermission.Info) {
  const ruleset: Rule[] = []
  for (const [key, value] of Object.entries(permission)) {
    if (typeof value === "string") {
      ruleset.push({ permission: key, action: value, pattern: "*" })
      continue
    }
    ruleset.push(
      ...Object.entries(value).map(([pattern, action]) => ({ permission: key, pattern: expand(pattern), action })),
    )
  }
  return ruleset
}

export function merge(...rulesets: Ruleset[]): Rule[] {
  return [...PermissionV2.merge(...rulesets)]
}

export function disabled(tools: string[], ruleset: Ruleset): Set<string> {
  return PermissionV2.disabled(tools, ruleset)
}

export const defaultLayer = layer.pipe(Layer.provide(Database.defaultLayer), Layer.provide(EventV2Bridge.defaultLayer))

export * as Permission from "."
