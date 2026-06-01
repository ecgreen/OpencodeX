import { index, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { Timestamps } from "../database/schema.sql"
import { ProjectTable } from "../project/sql"
import { ProjectV2 } from "../project"
import { SessionTable } from "../session/sql"

export const OpencodeXProjectTable = sqliteTable(
  "opencodex_project",
  {
    id: text().primaryKey(),
    project_id: text()
      .$type<ProjectV2.ID>()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    name: text(),
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
