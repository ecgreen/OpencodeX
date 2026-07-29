import { sqliteTable, text, integer, index, primaryKey, real, uniqueIndex } from "drizzle-orm/sqlite-core"
import { ProjectTable } from "../project/sql"
import type { Snapshot } from "../snapshot"
import { PermissionV2 } from "../permission"
import { ProjectV2 } from "../project"
import type { SessionSchema } from "./schema"
import type { MessageID, PartID, Info as LegacyMessageInfo, Part as LegacyMessagePart } from "./legacy"
import { WorkspaceV2 } from "../workspace"
import { Timestamps } from "../database/schema.sql"

type LegacyMessageData = Omit<LegacyMessageInfo, "id" | "sessionID">
type LegacyPartData = Omit<LegacyMessagePart, "id" | "sessionID" | "messageID">

export const SessionTable = sqliteTable(
  "session",
  {
    id: text().$type<SessionSchema.ID>().primaryKey(),
    project_id: text()
      .$type<ProjectV2.ID>()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    workspace_id: text().$type<WorkspaceV2.ID>(),
    parent_id: text().$type<SessionSchema.ID>(),
    slug: text().notNull(),
    directory: text().notNull(),
    path: text(),
    title: text().notNull(),
    version: text().notNull(),
    summary_additions: integer(),
    summary_deletions: integer(),
    summary_files: integer(),
    summary_diffs: text({ mode: "json" }).$type<Snapshot.FileDiff[]>(),
    metadata: text({ mode: "json" }).$type<Record<string, unknown>>(),
    cost: real().notNull().default(0),
    tokens_input: integer().notNull().default(0),
    tokens_output: integer().notNull().default(0),
    tokens_reasoning: integer().notNull().default(0),
    tokens_cache_read: integer().notNull().default(0),
    tokens_cache_write: integer().notNull().default(0),
    revert: text({ mode: "json" }).$type<{ messageID: MessageID; partID?: PartID; snapshot?: string; diff?: string }>(),
    permission: text({ mode: "json" }).$type<PermissionV2.Ruleset>(),
    agent: text(),
    model: text({ mode: "json" }).$type<{
      id: string
      providerID: string
      variant?: string
    }>(),
    ...Timestamps,
    time_compacting: integer(),
    time_archived: integer(),
  },
  (table) => [
    index("session_project_idx").on(table.project_id),
    index("session_workspace_idx").on(table.workspace_id),
    index("session_parent_idx").on(table.parent_id),
    index("session_time_updated_id_idx").on(table.time_updated, table.id),
  ],
)

export const MessageTable = sqliteTable(
  "message",
  {
    id: text().$type<MessageID>().primaryKey(),
    session_id: text()
      .$type<SessionSchema.ID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    ...Timestamps,
    data: text({ mode: "json" }).notNull().$type<LegacyMessageData>(),
  },
  (table) => [index("message_session_time_created_id_idx").on(table.session_id, table.time_created, table.id)],
)

export const PartTable = sqliteTable(
  "part",
  {
    id: text().$type<PartID>().primaryKey(),
    message_id: text()
      .$type<MessageID>()
      .notNull()
      .references(() => MessageTable.id, { onDelete: "cascade" }),
    session_id: text().$type<SessionSchema.ID>().notNull(),
    ...Timestamps,
    data: text({ mode: "json" }).notNull().$type<LegacyPartData>(),
  },
  (table) => [
    index("part_message_id_id_idx").on(table.message_id, table.id),
    index("part_session_idx").on(table.session_id),
  ],
)

export const TodoTable = sqliteTable(
  "todo",
  {
    session_id: text()
      .$type<SessionSchema.ID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    content: text().notNull(),
    status: text().notNull(),
    priority: text().notNull(),
    position: integer().notNull(),
    ...Timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.session_id, table.position] }),
    index("todo_session_idx").on(table.session_id),
  ],
)

export const PermissionTable = sqliteTable("permission", {
  project_id: text()
    .primaryKey()
    .references(() => ProjectTable.id, { onDelete: "cascade" }),
  ...Timestamps,
  data: text({ mode: "json" }).notNull().$type<PermissionV2.Ruleset>(),
})

export const SessionExecutionTable = sqliteTable(
  "session_execution",
  {
    session_id: text().$type<SessionSchema.ID>().primaryKey(),
    project_id: text().notNull(),
    directory: text().notNull(),
    state: text().$type<"idle" | "queued" | "running" | "interrupted">().notNull(),
    owner_id: text(),
    generation: integer().notNull().default(0),
    lease_expires_at: integer(),
    cancel_requested_at: integer(),
    queued_at: integer(),
    started_at: integer(),
    completed_at: integer(),
    ...Timestamps,
  },
  (table) => [
    index("session_execution_state_idx").on(table.state, table.lease_expires_at),
    index("session_execution_directory_idx").on(table.directory),
  ],
)

export const SessionStatusTable = sqliteTable(
  "session_status",
  {
    session_id: text().$type<SessionSchema.ID>().primaryKey(),
    project_id: text().notNull(),
    directory: text().notNull(),
    status: text({ mode: "json" }).$type<Record<string, unknown>>().notNull(),
    ...Timestamps,
  },
  (table) => [index("session_status_directory_idx").on(table.directory)],
)

export const SessionInteractionTable = sqliteTable(
  "session_interaction",
  {
    id: text().primaryKey(),
    kind: text().$type<"permission" | "question">().notNull(),
    session_id: text().$type<SessionSchema.ID>().notNull(),
    project_id: text().notNull(),
    directory: text().notNull(),
    state: text().$type<"pending" | "replied" | "rejected">().notNull(),
    request_json: text({ mode: "json" }).$type<Record<string, unknown>>().notNull(),
    response_json: text({ mode: "json" }).$type<Record<string, unknown>>(),
    responded_at: integer(),
    ...Timestamps,
  },
  (table) => [
    index("session_interaction_pending_idx").on(table.kind, table.state, table.directory),
    index("session_interaction_session_idx").on(table.session_id, table.state),
  ],
)

export const SessionCommandTable = sqliteTable(
  "session_command",
  {
    id: text().primaryKey(),
    session_id: text().$type<SessionSchema.ID>().notNull(),
    message_id: text().$type<MessageID>().notNull(),
    project_id: text().notNull(),
    directory: text().notNull(),
    status: text().$type<"queued" | "running" | "succeeded" | "failed" | "cancelled">().notNull(),
    owner_id: text(),
    claim_generation: integer().notNull().default(0),
    lease_expires_at: integer(),
    error: text(),
    started_at: integer(),
    completed_at: integer(),
    ...Timestamps,
  },
  (table) => [
    index("session_command_status_idx").on(table.status, table.directory),
    index("session_command_session_idx").on(table.session_id, table.status),
    index("session_command_lease_idx").on(table.status, table.lease_expires_at),
    uniqueIndex("session_command_message_idx").on(table.session_id, table.message_id),
  ],
)
