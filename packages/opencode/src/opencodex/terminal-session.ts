import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { NonNegativeInt } from "@opencode-ai/core/schema"
import { Identifier } from "@opencode-ai/core/util/identifier"
import { OpencodeXTerminalSessionTable } from "@opencode-ai/core/opencodex/sql"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Context, Effect, Layer, Schema, Semaphore } from "effect"
import { asc, eq, inArray } from "drizzle-orm"
import { OpencodeXProjectFolder } from "./project-folder"

export const Driver = Schema.Literal("claude-code")
export type Driver = Schema.Schema.Type<typeof Driver>

export const Info = Schema.Struct({
  id: Schema.String,
  driver: Driver,
  title: Schema.String,
  projectID: Schema.optional(Schema.String),
  directory: Schema.String,
  resumeID: Schema.String,
  installationID: Schema.String,
  /** Set once the headless driver mirrors this conversation into a session. */
  sessionID: Schema.optional(Schema.String),
  timeCreated: Schema.Number,
  timeUpdated: Schema.Number,
  timeLaunched: Schema.optional(Schema.Number),
  timeOpened: Schema.optional(Schema.Number),
}).annotate({ identifier: "OpencodeXTerminalSession" })
export type Info = Schema.Schema.Type<typeof Info>

export const CreateInput = Schema.Struct({
  title: Schema.optional(Schema.String),
  projectID: Schema.optional(Schema.String),
  directory: Schema.String,
  installationID: Schema.String,
}).annotate({ identifier: "OpencodeXTerminalSessionCreateInput" })
export type CreateInput = Schema.Schema.Type<typeof CreateInput>

export const UpdateInput = Schema.Struct({
  id: Schema.String,
  expectedTimeUpdated: NonNegativeInt,
  title: Schema.optional(Schema.String),
  projectID: Schema.optional(Schema.NullOr(Schema.String)),
}).annotate({ identifier: "OpencodeXTerminalSessionUpdateInput" })
export type UpdateInput = Schema.Schema.Type<typeof UpdateInput>

export const Event = {
  Created: EventV2.define({
    type: "opencodex.terminal_session.created",
    sync: { aggregate: "terminalSessionID", version: 1 },
    schema: { terminalSessionID: Schema.String },
  }),
  Updated: EventV2.define({
    type: "opencodex.terminal_session.updated",
    sync: { aggregate: "terminalSessionID", version: 1 },
    schema: { terminalSessionID: Schema.String },
  }),
  Deleted: EventV2.define({
    type: "opencodex.terminal_session.deleted",
    sync: { aggregate: "terminalSessionID", version: 1 },
    schema: { terminalSessionID: Schema.String },
  }),
}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()(
  "OpencodeX.TerminalSession.NotFoundError",
  { terminalSessionID: Schema.String },
) {}

export class ValidationError extends Schema.TaggedErrorClass<ValidationError>()(
  "OpencodeX.TerminalSession.ValidationError",
  { message: Schema.String },
) {}

export class ConflictError extends Schema.TaggedErrorClass<ConflictError>()(
  "OpencodeX.TerminalSession.ConflictError",
  { terminalSessionID: Schema.String },
) {}

export interface Interface {
  readonly list: () => Effect.Effect<Info[]>
  readonly listByIDs: (terminalSessionIDs: readonly string[]) => Effect.Effect<Info[]>
  readonly get: (terminalSessionID: string) => Effect.Effect<Info, NotFoundError>
  readonly create: (input: CreateInput) => Effect.Effect<Info, ValidationError>
  readonly update: (input: UpdateInput) => Effect.Effect<Info, NotFoundError | ValidationError | ConflictError>
  readonly opened: (terminalSessionID: string) => Effect.Effect<Info, NotFoundError>
  readonly link: (terminalSessionID: string, sessionID: string) => Effect.Effect<Info, NotFoundError>
  readonly remove: (terminalSessionID: string) => Effect.Effect<boolean, NotFoundError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/OpencodeXTerminalSession") {}

export function fromRow(row: typeof OpencodeXTerminalSessionTable.$inferSelect): Info {
  return {
    id: row.id,
    driver: row.driver,
    title: row.title,
    projectID: row.project_id ?? undefined,
    directory: row.directory,
    resumeID: row.resume_id,
    installationID: row.installation_id,
    sessionID: row.session_id ?? undefined,
    timeCreated: row.time_created,
    timeUpdated: row.time_updated,
    timeLaunched: row.time_launched ?? undefined,
    timeOpened: row.time_opened ?? undefined,
  }
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const events = yield* EventV2Bridge.Service
    const mutationLock = Semaphore.makeUnsafe(1)

    const requireProject = Effect.fn("OpencodeXTerminalSession.requireProject")(function* (projectID?: string | null) {
      if (!projectID) return
      if (yield* OpencodeXProjectFolder.getProject(db, projectID)) return
      yield* new ValidationError({ message: `Project not found: ${projectID}` })
    })

    const list = Effect.fn("OpencodeXTerminalSession.list")(function* () {
      return (yield* db
        .select()
        .from(OpencodeXTerminalSessionTable)
        .orderBy(asc(OpencodeXTerminalSessionTable.time_created), asc(OpencodeXTerminalSessionTable.id))
        .all()
        .pipe(Effect.orDie)).map(fromRow)
    })

    const listByIDs = Effect.fn("OpencodeXTerminalSession.listByIDs")(function* (
      terminalSessionIDs: readonly string[],
    ) {
      const ids = [...new Set(terminalSessionIDs)]
      if (ids.length === 0) return []
      const byID = new Map(
        (yield* db
          .select()
          .from(OpencodeXTerminalSessionTable)
          .where(inArray(OpencodeXTerminalSessionTable.id, ids))
          .all()
          .pipe(Effect.orDie)).map((row) => [row.id, fromRow(row)]),
      )
      return ids.flatMap((id) => byID.get(id) ?? [])
    })

    const get = Effect.fn("OpencodeXTerminalSession.get")(function* (terminalSessionID: string) {
      const row = yield* db
        .select()
        .from(OpencodeXTerminalSessionTable)
        .where(eq(OpencodeXTerminalSessionTable.id, terminalSessionID))
        .get()
        .pipe(Effect.orDie)
      if (!row) return yield* new NotFoundError({ terminalSessionID })
      return fromRow(row)
    })

    const createUnlocked = Effect.fnUntraced(function* (input: CreateInput) {
      const directory = input.directory.trim()
      const installationID = input.installationID.trim()
      if (!directory) return yield* new ValidationError({ message: "A working directory is required." })
      if (!isUUID(installationID)) return yield* new ValidationError({ message: "A valid installation UUID is required." })
      yield* requireProject(input.projectID)
      const id = `oxts_${Identifier.ascending()}`
      const now = Date.now()
      const event = yield* events.barrier(
        db.transaction(
          (transaction) =>
            Effect.gen(function* () {
              yield* transaction
                .insert(OpencodeXTerminalSessionTable)
                .values({
                  id,
                  driver: "claude-code",
                  title: input.title?.trim() || "Claude Code",
                  project_id: input.projectID,
                  directory,
                  resume_id: crypto.randomUUID(),
                  installation_id: installationID,
                  time_created: now,
                  time_updated: now,
                })
                .run()
              return yield* events.commit(Event.Created, { terminalSessionID: id })
            }),
          { behavior: "immediate" },
        ).pipe(Effect.catchTag("SqlError", Effect.die), Effect.catchTag("EffectDrizzleQueryError", Effect.die)),
      )
      const result = yield* get(id).pipe(Effect.orDie)
      yield* events.broadcast(event)
      return result
    })

    const create = Effect.fn("OpencodeXTerminalSession.create")(function* (input: CreateInput) {
      return yield* mutationLock.withPermits(1)(createUnlocked(input))
    })

    const updateUnlocked = Effect.fnUntraced(function* (input: UpdateInput) {
      yield* requireProject(input.projectID)
      const event = yield* events.barrier(
        db.transaction(
          (transaction) =>
            Effect.gen(function* () {
              const current = yield* transaction
                .select()
                .from(OpencodeXTerminalSessionTable)
                .where(eq(OpencodeXTerminalSessionTable.id, input.id))
                .get()
              if (!current) return yield* new NotFoundError({ terminalSessionID: input.id })
              if (current.time_updated !== input.expectedTimeUpdated) {
                return yield* new ConflictError({ terminalSessionID: input.id })
              }
              yield* transaction
                .update(OpencodeXTerminalSessionTable)
                .set({
                  title: input.title === undefined ? undefined : input.title.trim() || "Claude Code",
                  project_id: input.projectID,
                  time_updated: Math.max(Date.now(), current.time_updated + 1),
                })
                .where(eq(OpencodeXTerminalSessionTable.id, input.id))
                .run()
              return yield* events.commit(Event.Updated, { terminalSessionID: input.id })
            }),
          { behavior: "immediate" },
        ).pipe(Effect.catchTag("SqlError", Effect.die), Effect.catchTag("EffectDrizzleQueryError", Effect.die)),
      )
      const result = yield* get(input.id)
      yield* events.broadcast(event)
      return result
    })

    const update = Effect.fn("OpencodeXTerminalSession.update")(function* (input: UpdateInput) {
      return yield* mutationLock.withPermits(1)(updateUnlocked(input))
    })

    const openedUnlocked = Effect.fnUntraced(function* (terminalSessionID: string) {
      const event = yield* events.barrier(
        db.transaction(
          (transaction) =>
            Effect.gen(function* () {
              const current = yield* transaction
                .select()
                .from(OpencodeXTerminalSessionTable)
                .where(eq(OpencodeXTerminalSessionTable.id, terminalSessionID))
                .get()
              if (!current) return yield* new NotFoundError({ terminalSessionID })
              const now = Math.max(Date.now(), current.time_updated + 1)
              yield* transaction
                .update(OpencodeXTerminalSessionTable)
                .set({ time_launched: current.time_launched ?? now, time_opened: now, time_updated: now })
                .where(eq(OpencodeXTerminalSessionTable.id, terminalSessionID))
                .run()
              return yield* events.commit(Event.Updated, { terminalSessionID })
            }),
          { behavior: "immediate" },
        ).pipe(Effect.catchTag("SqlError", Effect.die), Effect.catchTag("EffectDrizzleQueryError", Effect.die)),
      )
      const result = yield* get(terminalSessionID)
      yield* events.broadcast(event)
      return result
    })

    const opened = Effect.fn("OpencodeXTerminalSession.opened")(function* (terminalSessionID: string) {
      return yield* mutationLock.withPermits(1)(openedUnlocked(terminalSessionID))
    })

    const linkUnlocked = Effect.fnUntraced(function* (terminalSessionID: string, sessionID: string) {
      const event = yield* events.barrier(
        db.transaction(
          (transaction) =>
            Effect.gen(function* () {
              const current = yield* transaction
                .select()
                .from(OpencodeXTerminalSessionTable)
                .where(eq(OpencodeXTerminalSessionTable.id, terminalSessionID))
                .get()
              if (!current) return yield* new NotFoundError({ terminalSessionID })
              // Linking is idempotent: a record keeps the first mirror session
              // it was given so a restarted driver reattaches instead of forking.
              if (current.session_id) return undefined
              const now = Math.max(Date.now(), current.time_updated + 1)
              yield* transaction
                .update(OpencodeXTerminalSessionTable)
                .set({ session_id: sessionID as never, time_updated: now })
                .where(eq(OpencodeXTerminalSessionTable.id, terminalSessionID))
                .run()
              return yield* events.commit(Event.Updated, { terminalSessionID })
            }),
          { behavior: "immediate" },
        ).pipe(Effect.catchTag("SqlError", Effect.die), Effect.catchTag("EffectDrizzleQueryError", Effect.die)),
      )
      const result = yield* get(terminalSessionID)
      if (event) yield* events.broadcast(event)
      return result
    })

    const link = Effect.fn("OpencodeXTerminalSession.link")(function* (terminalSessionID: string, sessionID: string) {
      return yield* mutationLock.withPermits(1)(linkUnlocked(terminalSessionID, sessionID))
    })

    const removeUnlocked = Effect.fnUntraced(function* (terminalSessionID: string) {
      const event = yield* events.barrier(
        db.transaction(
          (transaction) =>
            Effect.gen(function* () {
              const current = yield* transaction
                .select({ id: OpencodeXTerminalSessionTable.id })
                .from(OpencodeXTerminalSessionTable)
                .where(eq(OpencodeXTerminalSessionTable.id, terminalSessionID))
                .get()
              if (!current) return yield* new NotFoundError({ terminalSessionID })
              yield* transaction
                .delete(OpencodeXTerminalSessionTable)
                .where(eq(OpencodeXTerminalSessionTable.id, terminalSessionID))
                .run()
              return yield* events.commit(Event.Deleted, { terminalSessionID })
            }),
          { behavior: "immediate" },
        ).pipe(Effect.catchTag("SqlError", Effect.die), Effect.catchTag("EffectDrizzleQueryError", Effect.die)),
      )
      yield* events.broadcast(event)
      return true
    })

    const remove = Effect.fn("OpencodeXTerminalSession.remove")(function* (terminalSessionID: string) {
      return yield* mutationLock.withPermits(1)(removeUnlocked(terminalSessionID))
    })

    return Service.of({ list, listByIDs, get, create, update, opened, link, remove })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Database.defaultLayer),
  Layer.provide(EventV2Bridge.defaultLayer),
)

function isUUID(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

export * as OpencodeXTerminalSession from "./terminal-session"
