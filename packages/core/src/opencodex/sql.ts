import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { Timestamps } from "../database/schema.sql"
import { ProjectTable } from "../project/sql"
import { ProjectV2 } from "../project"
import { SessionTable } from "../session/sql"
import type { SessionSchema } from "../session/schema"

export const OpencodeXProjectTable = sqliteTable(
  "opencodex_project",
  {
    id: text().primaryKey(),
    project_id: text()
      .$type<ProjectV2.ID>()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    name: text(),
    sort_order: integer().notNull().default(0),
    ...Timestamps,
  },
  (table) => [index("opencodex_project_project_idx").on(table.project_id)],
)

export const OpencodeXProjectFolderTable = sqliteTable(
  "opencodex_project_folder",
  {
    path: text().notNull(),
    opencodex_project_id: text()
      .notNull()
      .references(() => OpencodeXProjectTable.id, { onDelete: "cascade" }),
    project_id: text()
      .$type<ProjectV2.ID>()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    ...Timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.opencodex_project_id, table.path] }),
    index("opencodex_project_folder_opencodex_project_idx").on(table.opencodex_project_id),
    index("opencodex_project_folder_project_idx").on(table.project_id),
  ],
)

export const OpencodeXProjectSessionTable = sqliteTable(
  "opencodex_project_session",
  {
    session_id: text()
      .$type<SessionSchema.ID>()
      .primaryKey()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    opencodex_project_id: text()
      .notNull()
      .references(() => OpencodeXProjectTable.id, { onDelete: "cascade" }),
    path: text().notNull(),
    ...Timestamps,
  },
  (table) => [index("opencodex_project_session_project_idx").on(table.opencodex_project_id)],
)

export const OpencodeXSessionStateTable = sqliteTable(
  "opencodex_session_state",
  {
    session_id: text()
      .$type<SessionSchema.ID>()
      .primaryKey()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    seen_at: integer(),
    reviewed_at: integer(),
    reviewed_files: text({ mode: "json" }).$type<string[]>().notNull(),
    ...Timestamps,
  },
  (table) => [index("opencodex_session_state_updated_idx").on(table.time_updated)],
)

export const OpencodeXViewTable = sqliteTable(
  "opencodex_view",
  {
    id: text().primaryKey(),
    title: text().notNull(),
    focused_session_id: text().$type<SessionSchema.ID>().references(() => SessionTable.id, { onDelete: "set null" }),
    layout: text().notNull().default("auto"),
    metadata_json: text(),
    ...Timestamps,
  },
  (table) => [
    index("opencodex_view_focused_session_idx").on(table.focused_session_id),
    index("opencodex_view_updated_idx").on(table.time_updated),
  ],
)

export const OpencodeXViewSessionTable = sqliteTable(
  "opencodex_view_session",
  {
    view_id: text()
      .notNull()
      .references(() => OpencodeXViewTable.id, { onDelete: "cascade" }),
    session_id: text()
      .$type<SessionSchema.ID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    sort_order: integer().notNull().default(0),
    ...Timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.view_id, table.session_id] }),
    index("opencodex_view_session_view_idx").on(table.view_id),
    index("opencodex_view_session_session_idx").on(table.session_id),
  ],
)

export const OpencodeXJobTable = sqliteTable(
  "opencodex_job",
  {
    id: text().primaryKey(),
    kind: text().notNull(),
    title: text(),
    status: text().notNull(),
    source: text().notNull(),
    opencodex_project_id: text().references(() => OpencodeXProjectTable.id, { onDelete: "set null" }),
    session_id: text().$type<SessionSchema.ID>().references(() => SessionTable.id, { onDelete: "set null" }),
    parent_job_id: text(),
    swarm_id: text(),
    role_id: text(),
    agent: text(),
    provider_id: text(),
    model_id: text(),
    started_at: integer(),
    completed_at: integer(),
    status_reason: text(),
    metadata_json: text(),
    ...Timestamps,
  },
  (table) => [
    index("opencodex_job_project_idx").on(table.opencodex_project_id),
    index("opencodex_job_session_idx").on(table.session_id),
    index("opencodex_job_swarm_idx").on(table.swarm_id),
    index("opencodex_job_status_idx").on(table.status),
    index("opencodex_job_updated_idx").on(table.time_updated),
  ],
)

export const OpencodeXSwarmTable = sqliteTable(
  "opencodex_swarm",
  {
    id: text().primaryKey(),
    opencodex_project_id: text()
      .notNull()
      .references(() => OpencodeXProjectTable.id, { onDelete: "cascade" }),
    title: text().notNull(),
    prompt: text().notNull(),
    status: text().notNull(),
    source: text().notNull(),
    created_by: text(),
    synthesis_session_id: text().$type<SessionSchema.ID>().references(() => SessionTable.id, { onDelete: "set null" }),
    started_at: integer(),
    completed_at: integer(),
    metadata_json: text(),
    ...Timestamps,
  },
  (table) => [
    index("opencodex_swarm_project_idx").on(table.opencodex_project_id),
    index("opencodex_swarm_status_idx").on(table.status),
    index("opencodex_swarm_updated_idx").on(table.time_updated),
  ],
)

export const OpencodeXSwarmRunTable = sqliteTable(
  "opencodex_swarm_run",
  {
    id: text().primaryKey(),
    swarm_id: text()
      .notNull()
      .references(() => OpencodeXSwarmTable.id, { onDelete: "cascade" }),
    opencodex_project_id: text().references(() => OpencodeXProjectTable.id, { onDelete: "set null" }),
    title: text().notNull(),
    prompt: text().notNull(),
    status: text().notNull(),
    source: text().notNull(),
    orchestrator_session_id: text().$type<SessionSchema.ID>().references(() => SessionTable.id, { onDelete: "set null" }),
    result_session_id: text().$type<SessionSchema.ID>().references(() => SessionTable.id, { onDelete: "set null" }),
    started_at: integer(),
    completed_at: integer(),
    metadata_json: text(),
    ...Timestamps,
  },
  (table) => [
    index("opencodex_swarm_run_swarm_idx").on(table.swarm_id),
    index("opencodex_swarm_run_project_idx").on(table.opencodex_project_id),
    index("opencodex_swarm_run_orchestrator_session_idx").on(table.orchestrator_session_id),
    index("opencodex_swarm_run_status_idx").on(table.status),
    index("opencodex_swarm_run_updated_idx").on(table.time_updated),
  ],
)

export const OpencodeXSwarmRoleTable = sqliteTable(
  "opencodex_swarm_role",
  {
    id: text().primaryKey(),
    swarm_id: text()
      .notNull()
      .references(() => OpencodeXSwarmTable.id, { onDelete: "cascade" }),
    name: text().notNull(),
    agent: text(),
    skill: text(),
    provider_id: text(),
    model_id: text(),
    model_profile: text(),
    status: text().notNull(),
    instructions: text().notNull(),
    sort_order: integer().notNull().default(0),
    session_id: text().$type<SessionSchema.ID>().references(() => SessionTable.id, { onDelete: "set null" }),
    job_id: text().references(() => OpencodeXJobTable.id, { onDelete: "set null" }),
    metadata_json: text(),
    ...Timestamps,
  },
  (table) => [
    index("opencodex_swarm_role_swarm_idx").on(table.swarm_id),
    index("opencodex_swarm_role_session_idx").on(table.session_id),
    index("opencodex_swarm_role_job_idx").on(table.job_id),
    index("opencodex_swarm_role_status_idx").on(table.status),
  ],
)

export const OpencodeXSwarmAgentRunTable = sqliteTable(
  "opencodex_swarm_agent_run",
  {
    id: text().primaryKey(),
    run_id: text()
      .notNull()
      .references(() => OpencodeXSwarmRunTable.id, { onDelete: "cascade" }),
    swarm_id: text()
      .notNull()
      .references(() => OpencodeXSwarmTable.id, { onDelete: "cascade" }),
    role_id: text().references(() => OpencodeXSwarmRoleTable.id, { onDelete: "set null" }),
    status: text().notNull(),
    prompt: text().notNull(),
    session_id: text().$type<SessionSchema.ID>().references(() => SessionTable.id, { onDelete: "set null" }),
    job_id: text().references(() => OpencodeXJobTable.id, { onDelete: "set null" }),
    metadata_json: text(),
    started_at: integer(),
    completed_at: integer(),
    ...Timestamps,
  },
  (table) => [
    index("opencodex_swarm_agent_run_run_idx").on(table.run_id),
    index("opencodex_swarm_agent_run_swarm_idx").on(table.swarm_id),
    index("opencodex_swarm_agent_run_role_idx").on(table.role_id),
    index("opencodex_swarm_agent_run_session_idx").on(table.session_id),
    index("opencodex_swarm_agent_run_job_idx").on(table.job_id),
    index("opencodex_swarm_agent_run_status_idx").on(table.status),
  ],
)

export const OpencodeXSwarmEventTable = sqliteTable(
  "opencodex_swarm_event",
  {
    id: text().primaryKey(),
    swarm_id: text()
      .notNull()
      .references(() => OpencodeXSwarmTable.id, { onDelete: "cascade" }),
    run_id: text().references(() => OpencodeXSwarmRunTable.id, { onDelete: "set null" }),
    role_id: text().references(() => OpencodeXSwarmRoleTable.id, { onDelete: "set null" }),
    session_id: text().$type<SessionSchema.ID>().references(() => SessionTable.id, { onDelete: "set null" }),
    kind: text().notNull(),
    message: text().notNull(),
    metadata_json: text(),
    ...Timestamps,
  },
  (table) => [
    index("opencodex_swarm_event_swarm_idx").on(table.swarm_id),
    index("opencodex_swarm_event_run_idx").on(table.run_id),
    index("opencodex_swarm_event_role_idx").on(table.role_id),
    index("opencodex_swarm_event_session_idx").on(table.session_id),
    index("opencodex_swarm_event_created_idx").on(table.time_created),
  ],
)
