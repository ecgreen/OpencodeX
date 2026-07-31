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

export const OpencodeXTerminalSessionTable = sqliteTable(
  "opencodex_terminal_session",
  {
    id: text().primaryKey(),
    driver: text().$type<"claude-code">().notNull(),
    title: text().notNull(),
    project_id: text().references(() => OpencodeXProjectTable.id, { onDelete: "set null" }),
    directory: text().notNull(),
    resume_id: text().notNull(),
    installation_id: text().notNull(),
    // The mirrored OpencodeX session this Claude conversation writes into.
    session_id: text()
      .$type<SessionSchema.ID>()
      .references(() => SessionTable.id, { onDelete: "set null" }),
    time_launched: integer(),
    time_opened: integer(),
    ...Timestamps,
  },
  (table) => [
    index("opencodex_terminal_session_project_idx").on(table.project_id),
    index("opencodex_terminal_session_installation_idx").on(table.installation_id),
    index("opencodex_terminal_session_session_idx").on(table.session_id),
    index("opencodex_terminal_session_updated_idx").on(table.time_updated),
  ],
)

export const OpencodeXStateEventTable = sqliteTable(
  "opencodex_state_event",
  {
    position: integer().primaryKey({ autoIncrement: true }),
    id: text().notNull().unique(),
    visibility: text().$type<"global" | "instance">().notNull().default("instance"),
    project_id: text().notNull(),
    workspace_id: text(),
    directory: text().notNull(),
    aggregate_id: text().notNull(),
    aggregate_sequence: integer().notNull(),
    domain: text().notNull(),
    event_type: text().notNull(),
    operation: text().notNull(),
    payload: text({ mode: "json" }).$type<Record<string, unknown>>().notNull(),
    created_at: integer().notNull(),
  },
  (table) => [
    index("opencodex_state_event_visibility_position_idx").on(table.visibility, table.position),
    index("opencodex_state_event_scope_position_idx").on(
      table.project_id,
      table.workspace_id,
      table.directory,
      table.position,
    ),
    index("opencodex_state_event_aggregate_idx").on(
      table.project_id,
      table.workspace_id,
      table.directory,
      table.aggregate_id,
      table.aggregate_sequence,
    ),
  ],
)

export const OpencodeXStateAggregateSequenceTable = sqliteTable(
  "opencodex_state_aggregate_sequence",
  {
    visibility: text().$type<"global" | "instance">().notNull(),
    project_id: text().notNull(),
    workspace_id: text().notNull(),
    directory: text().notNull(),
    aggregate_id: text().notNull(),
    aggregate_sequence: integer().notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.visibility, table.project_id, table.workspace_id, table.directory, table.aggregate_id],
    }),
  ],
)

export const OpencodeXStateMetadataTable = sqliteTable("opencodex_state_metadata", {
  key: text().primaryKey(),
  value: text().notNull(),
})

export const OpencodeXViewTable = sqliteTable(
  "opencodex_view",
  {
    id: text().primaryKey(),
    title: text().notNull(),
    focused_session_id: text()
      .$type<SessionSchema.ID>()
      .references(() => SessionTable.id, { onDelete: "set null" }),
    focused_item_id: text(),
    layout: text().notNull().default("auto"),
    sort_order: integer().notNull().default(0),
    metadata_json: text(),
    ...Timestamps,
  },
  (table) => [
    index("opencodex_view_focused_session_idx").on(table.focused_session_id),
    index("opencodex_view_focused_item_idx").on(table.focused_item_id),
    index("opencodex_view_updated_idx").on(table.time_updated),
  ],
)

export const OpencodeXViewTerminalSessionTable = sqliteTable(
  "opencodex_view_terminal_session",
  {
    view_id: text()
      .notNull()
      .references(() => OpencodeXViewTable.id, { onDelete: "cascade" }),
    terminal_session_id: text()
      .notNull()
      .references(() => OpencodeXTerminalSessionTable.id, { onDelete: "cascade" }),
    sort_order: integer().notNull().default(0),
    ...Timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.view_id, table.terminal_session_id] }),
    index("opencodex_view_terminal_session_view_idx").on(table.view_id),
    index("opencodex_view_terminal_session_terminal_idx").on(table.terminal_session_id),
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
    session_id: text()
      .$type<SessionSchema.ID>()
      .references(() => SessionTable.id, { onDelete: "set null" }),
    parent_job_id: text(),
    swarm_id: text(),
    role_id: text(),
    agent: text(),
    provider_id: text(),
    model_id: text(),
    idempotency_key: text().unique(),
    attempt: integer().notNull().default(0),
    max_attempts: integer().notNull().default(1),
    lease_owner: text(),
    lease_expires_at: integer(),
    timeout_at: integer(),
    cancel_requested_at: integer(),
    started_at: integer(),
    completed_at: integer(),
    status_reason: text(),
    result_json: text({ mode: "json" }).$type<Record<string, unknown>>(),
    failure_json: text({ mode: "json" }).$type<Record<string, unknown>>(),
    metadata_json: text(),
    ...Timestamps,
  },
  (table) => [
    index("opencodex_job_project_idx").on(table.opencodex_project_id),
    index("opencodex_job_session_idx").on(table.session_id),
    index("opencodex_job_swarm_idx").on(table.swarm_id),
    index("opencodex_job_status_idx").on(table.status),
    index("opencodex_job_lease_idx").on(table.status, table.lease_expires_at),
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
    synthesis_session_id: text()
      .$type<SessionSchema.ID>()
      .references(() => SessionTable.id, { onDelete: "set null" }),
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
    session_id: text()
      .$type<SessionSchema.ID>()
      .references(() => SessionTable.id, { onDelete: "set null" }),
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

export const OpencodeXGoalTable = sqliteTable(
  "opencodex_goal",
  {
    id: text().primaryKey(),
    opencodex_project_id: text()
      .notNull()
      .references(() => OpencodeXProjectTable.id, { onDelete: "cascade" }),
    title: text().notNull(),
    statement: text().notNull(),
    success_criteria_json: text({ mode: "json" }).$type<string[]>().notNull(),
    status: text().notNull(),
    source: text().notNull(),
    // The chat session that owns the goal. Standing goals have none, which is
    // what makes them standing.
    owner_session_id: text()
      .$type<SessionSchema.ID>()
      .references(() => SessionTable.id, { onDelete: "set null" }),
    swarm_id: text().references(() => OpencodeXSwarmTable.id, { onDelete: "set null" }),
    directory: text(),
    budget_json: text(),
    spend_json: text(),
    schedule_json: text(),
    status_reason: text(),
    metadata_json: text(),
    started_at: integer(),
    completed_at: integer(),
    ...Timestamps,
  },
  (table) => [
    index("opencodex_goal_project_idx").on(table.opencodex_project_id),
    index("opencodex_goal_session_idx").on(table.owner_session_id),
    index("opencodex_goal_swarm_idx").on(table.swarm_id),
    index("opencodex_goal_status_idx").on(table.status),
    index("opencodex_goal_updated_idx").on(table.time_updated),
  ],
)

export const OpencodeXGoalNodeTable = sqliteTable(
  "opencodex_goal_node",
  {
    // Planner-authored and unique within the goal, so edges and briefs can
    // name nodes with the same ids the planner wrote.
    id: text().notNull(),
    goal_id: text()
      .notNull()
      .references(() => OpencodeXGoalTable.id, { onDelete: "cascade" }),
    kind: text().notNull(),
    title: text().notNull(),
    brief: text().notNull(),
    status: text().notNull(),
    executor_json: text(),
    // The loop node this node is a body member of.
    parent_node_id: text(),
    loop_json: text(),
    sort_order: integer().notNull().default(0),
    iteration: integer().notNull().default(0),
    attempt: integer().notNull().default(0),
    job_id: text().references(() => OpencodeXJobTable.id, { onDelete: "set null" }),
    session_id: text()
      .$type<SessionSchema.ID>()
      .references(() => SessionTable.id, { onDelete: "set null" }),
    // The exact text the executor received, captured at dispatch.
    delivered_prompt: text(),
    result_text: text(),
    verdict_json: text(),
    failure_reason: text(),
    metadata_json: text(),
    started_at: integer(),
    completed_at: integer(),
    ...Timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.goal_id, table.id] }),
    index("opencodex_goal_node_goal_idx").on(table.goal_id),
    index("opencodex_goal_node_parent_idx").on(table.parent_node_id),
    index("opencodex_goal_node_job_idx").on(table.job_id),
    index("opencodex_goal_node_session_idx").on(table.session_id),
    index("opencodex_goal_node_status_idx").on(table.status),
  ],
)

export const OpencodeXGoalEdgeTable = sqliteTable(
  "opencodex_goal_edge",
  {
    goal_id: text()
      .notNull()
      .references(() => OpencodeXGoalTable.id, { onDelete: "cascade" }),
    // Node ids are planner keys scoped to the goal, so the goal cascade above
    // is what keeps edges from outliving the nodes they name.
    from_node_id: text().notNull(),
    to_node_id: text().notNull(),
    kind: text().notNull(),
    ...Timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.goal_id, table.from_node_id, table.to_node_id, table.kind] }),
    index("opencodex_goal_edge_goal_idx").on(table.goal_id),
    index("opencodex_goal_edge_to_idx").on(table.to_node_id),
  ],
)

export const OpencodeXSwarmEventTable = sqliteTable(
  "opencodex_swarm_event",
  {
    id: text().primaryKey(),
    swarm_id: text()
      .notNull()
      .references(() => OpencodeXSwarmTable.id, { onDelete: "cascade" }),
    role_id: text().references(() => OpencodeXSwarmRoleTable.id, { onDelete: "set null" }),
    session_id: text()
      .$type<SessionSchema.ID>()
      .references(() => SessionTable.id, { onDelete: "set null" }),
    kind: text().notNull(),
    message: text().notNull(),
    metadata_json: text(),
    ...Timestamps,
  },
  (table) => [
    index("opencodex_swarm_event_swarm_idx").on(table.swarm_id),
    index("opencodex_swarm_event_role_idx").on(table.role_id),
    index("opencodex_swarm_event_session_idx").on(table.session_id),
    index("opencodex_swarm_event_created_idx").on(table.time_created),
  ],
)
