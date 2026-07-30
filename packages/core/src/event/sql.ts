import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"
import type { EventV2 } from "../event"

export const EventSequenceTable = sqliteTable("event_sequence", {
  aggregate_id: text().notNull().primaryKey(),
  seq: integer().notNull(),
  owner_id: text(),
})

export const EventTable = sqliteTable(
  "event",
  {
    id: text().$type<EventV2.ID>().primaryKey(),
    aggregate_id: text()
      .notNull()
      .references(() => EventSequenceTable.aggregate_id, { onDelete: "cascade" }),
    seq: integer().notNull(),
    type: text().notNull(),
    data: text({ mode: "json" }).$type<Record<string, unknown>>().notNull(),
  },
  // Every read of this table is "one aggregate, in sequence order", and the
  // cascade delete resolves by aggregate too. Without this the journal is
  // scanned end to end each time, which gets worse as it grows.
  (table) => [index("event_aggregate_seq_idx").on(table.aggregate_id, table.seq)],
)
