import { Database } from "@opencode-ai/core/database/database"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { OpencodeXSessionStateTable } from "@opencode-ai/core/opencodex/sql"
import { optionalOmitUndefined } from "@opencode-ai/core/schema"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { SessionID } from "@/session/schema"
import { Session } from "@/session/session"
import { OpencodeXSessionState } from "./session-state"
import { and, desc, eq, inArray, isNull, lt, or, sql, type SQL } from "drizzle-orm"
import { Effect, Encoding, Option, Result, Schema, Struct } from "effect"
import { renderableSessionWhere } from "./session-filter"

export const DEFAULT_LIMIT = 100
export const MAX_LIMIT = 200
export const MAX_RETAINED_IDS = 200

export const Cursor = Schema.String.pipe(Schema.brand("OpencodeXSessionCardCursor")).annotate({
  identifier: "OpencodeXSessionCardCursor",
})
export type Cursor = Schema.Schema.Type<typeof Cursor>

const Summary = Schema.Struct({
  additions: Schema.Finite,
  deletions: Schema.Finite,
  files: Schema.Finite,
})

export const Card = Schema.Struct({
  ...Struct.omit(Session.Info.fields, ["summary", "metadata", "permission", "revert"]),
  summary: optionalOmitUndefined(Summary),
}).annotate({ identifier: "OpencodeXSessionCard" })
export type Card = Schema.Schema.Type<typeof Card>

export const Page = Schema.Struct({
  items: Schema.Array(Card),
  hasMore: Schema.Boolean,
  next: Schema.optional(Cursor),
  missing: Schema.Array(SessionID),
  sessionUiState: Schema.Record(Schema.String, OpencodeXSessionState.UiState),
}).annotate({ identifier: "OpencodeXSessionCardPage" })
export type Page = Schema.Schema.Type<typeof Page>

export class InvalidCursorError extends Schema.TaggedErrorClass<InvalidCursorError>()(
  "OpencodeX.SessionCard.InvalidCursorError",
  { cursor: Schema.String },
) {}

const CursorPayload = Schema.Struct({
  version: Schema.Literal(1),
  timeUpdated: Schema.Number,
  id: SessionID,
})
const decodePayload = Schema.decodeUnknownOption(Schema.fromJsonString(CursorPayload))

const selection = {
  id: SessionTable.id,
  slug: SessionTable.slug,
  project_id: SessionTable.project_id,
  workspace_id: SessionTable.workspace_id,
  parent_id: SessionTable.parent_id,
  directory: SessionTable.directory,
  path: SessionTable.path,
  title: SessionTable.title,
  agent: SessionTable.agent,
  model: SessionTable.model,
  version: SessionTable.version,
  summary_additions: SessionTable.summary_additions,
  summary_deletions: SessionTable.summary_deletions,
  summary_files: SessionTable.summary_files,
  cost: SessionTable.cost,
  tokens_input: SessionTable.tokens_input,
  tokens_output: SessionTable.tokens_output,
  tokens_reasoning: SessionTable.tokens_reasoning,
  tokens_cache_read: SessionTable.tokens_cache_read,
  tokens_cache_write: SessionTable.tokens_cache_write,
  time_created: SessionTable.time_created,
  time_updated: SessionTable.time_updated,
  time_compacting: SessionTable.time_compacting,
  time_archived: SessionTable.time_archived,
}

type CardRow = Pick<
  typeof SessionTable.$inferSelect,
  | "id"
  | "slug"
  | "project_id"
  | "workspace_id"
  | "parent_id"
  | "directory"
  | "path"
  | "title"
  | "agent"
  | "model"
  | "version"
  | "summary_additions"
  | "summary_deletions"
  | "summary_files"
  | "cost"
  | "tokens_input"
  | "tokens_output"
  | "tokens_reasoning"
  | "tokens_cache_read"
  | "tokens_cache_write"
  | "time_created"
  | "time_updated"
  | "time_compacting"
  | "time_archived"
>

export function makeReader(db: Database.Interface["db"]) {
  const unseenReviewIDs = Effect.fn("OpencodeXSessionCard.unseenReviewIDs")(function* () {
    const rows = yield* db
      .select({ id: SessionTable.id })
      .from(SessionTable)
      .leftJoin(
        OpencodeXSessionStateTable,
        eq(OpencodeXSessionStateTable.session_id, SessionTable.id),
      )
      .where(
        and(
          renderableSessionWhere(),
          isNull(SessionTable.parent_id),
          sql`${SessionTable.time_updated} > coalesce(${OpencodeXSessionStateTable.seen_at}, 0)`,
          sql`${SessionTable.time_updated} > coalesce(${OpencodeXSessionStateTable.reviewed_at}, 0)`,
        ),
      )
      .orderBy(desc(SessionTable.time_updated), desc(SessionTable.id))
      .limit(MAX_RETAINED_IDS)
      .all()
      .pipe(Effect.orDie)
    return rows.map((row) => row.id)
  })

  const exact = Effect.fn("OpencodeXSessionCard.byID")(function* (sessionIDs: readonly SessionID[]) {
    const requested = [...new Set(sessionIDs)].slice(0, MAX_RETAINED_IDS)
    if (requested.length === 0) return { items: [], hasMore: false, missing: [] }
    const rows = yield* db
      .select(selection)
      .from(SessionTable)
      .where(
        and(inArray(SessionTable.id, requested), renderableSessionWhere()),
      )
      .orderBy(desc(SessionTable.time_updated), desc(SessionTable.id))
      .all()
      .pipe(Effect.orDie)
    const found = new Set(rows.map((row) => row.id))
    return {
      items: rows.map(hydrate),
      hasMore: false,
      missing: requested.filter((id) => !found.has(id)),
    }
  })

  const page = Effect.fn("OpencodeXSessionCard.page")(function* (input?: {
    cursor?: string
    limit?: number
    sessionIDs?: readonly SessionID[]
  }) {
    if (input?.sessionIDs) return yield* exact(input.sessionIDs)
    const limit = Math.min(MAX_LIMIT, Math.max(1, input?.limit ?? DEFAULT_LIMIT))
    const cursor = input?.cursor ? decodeCursor(input.cursor) : undefined
    if (input?.cursor && !cursor) return yield* new InvalidCursorError({ cursor: input.cursor })
    const conditions: SQL[] = [renderableSessionWhere()]
    if (cursor) {
      conditions.push(
        or(
          lt(SessionTable.time_updated, cursor.timeUpdated),
          and(eq(SessionTable.time_updated, cursor.timeUpdated), lt(SessionTable.id, cursor.id)),
        )!,
      )
    }
    const rows = yield* db
      .select(selection)
      .from(SessionTable)
      .where(and(...conditions))
      .orderBy(desc(SessionTable.time_updated), desc(SessionTable.id))
      .limit(limit + 1)
      .all()
      .pipe(Effect.orDie)
    const items = rows.slice(0, limit).map(hydrate)
    const boundary = items.at(-1)
    return {
      items,
      hasMore: rows.length > limit,
      ...(rows.length > limit && boundary
        ? { next: encodeCursor({ version: 1, timeUpdated: boundary.time.updated, id: boundary.id }) }
        : {}),
      missing: [],
    }
  })

  const initial = Effect.fn("OpencodeXSessionCard.initial")(function* (retainedSessionIDs: readonly SessionID[]) {
    const retainedIDs = [...new Set(retainedSessionIDs)].slice(0, MAX_RETAINED_IDS)
    const [recent, retained] = yield* Effect.all([page().pipe(Effect.orDie), exact(retainedIDs)], {
      concurrency: "unbounded",
    })
    return {
      ...recent,
      items: [...new Map([...retained.items, ...recent.items].map((item) => [item.id, item])).values()],
      missing: [],
    }
  })

  return { page, initial, unseenReviewIDs }
}

function encodeCursor(payload: typeof CursorPayload.Type) {
  return Cursor.make(Encoding.encodeBase64Url(JSON.stringify(payload)))
}

function decodeCursor(cursor: string) {
  const decoded = Encoding.decodeBase64UrlString(cursor)
  if (Result.isFailure(decoded)) return undefined
  return Option.getOrUndefined(decodePayload(decoded.success))
}

function hydrate(row: CardRow): Card {
  const summary =
    row.summary_additions !== null || row.summary_deletions !== null || row.summary_files !== null
      ? {
          additions: row.summary_additions ?? 0,
          deletions: row.summary_deletions ?? 0,
          files: row.summary_files ?? 0,
        }
      : undefined
  return {
    id: row.id,
    slug: row.slug,
    projectID: row.project_id,
    workspaceID: row.workspace_id ?? undefined,
    directory: row.directory,
    path: row.path ?? undefined,
    parentID: row.parent_id ?? undefined,
    title: row.title,
    agent: row.agent ?? undefined,
    model: row.model
      ? {
          id: ProviderV2.ModelID.make(row.model.id),
          providerID: ProviderV2.ID.make(row.model.providerID),
          variant: row.model.variant,
        }
      : undefined,
    version: row.version,
    summary,
    cost: row.cost,
    tokens: {
      input: row.tokens_input,
      output: row.tokens_output,
      reasoning: row.tokens_reasoning,
      cache: { read: row.tokens_cache_read, write: row.tokens_cache_write },
    },
    time: {
      created: row.time_created,
      updated: row.time_updated,
      compacting: row.time_compacting ?? undefined,
      archived: row.time_archived ?? undefined,
    },
  }
}

export * as OpencodeXSessionCard from "./session-card"
