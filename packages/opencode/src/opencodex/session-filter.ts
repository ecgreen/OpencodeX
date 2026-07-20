import { SessionTable } from "@opencode-ai/core/session/sql"
import { and, isNull, sql } from "drizzle-orm"

export function renderableSessionWhere() {
  return and(
    isNull(SessionTable.time_archived),
    sql`json_extract(${SessionTable.metadata}, '$.opencodex.swarmID') IS NULL`,
  )!
}
