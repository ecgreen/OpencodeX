import { Database } from "bun:sqlite"

const SESSION_COUNT = 250
const TRANSCRIPT_MESSAGE_COUNT = 640
const VIEW_SESSION_COUNT = 8
const FIXTURE_TIME = Date.UTC(2026, 0, 15, 12)
const FIXTURE_PROJECT_ID = "opx_performance_fixture"
const FIXTURE_VIEW_ID = "view_performance_fixture"

const titles = [
  "Performance Cache A",
  "Performance Cache B",
  "Performance Heavy Transcript",
  "Performance Cold 01",
  "Performance Cold 02",
  "Performance Cold 03",
  "Performance Cold 04",
  "Performance Cold 05",
]

export type PerformanceFixtureManifest = {
  sessionCards: number
  initialSessionCards: number
  transcriptMessages: number
  liveTailMessages: number
  loadMoreMessages: number
  remainingMessagesAfterLoadMore: number
  viewSessions: number
  heavyOutputLines: number
  heavyDiffLines: number
}

export function seedPerformanceFixture(input: { database: string; directory: string }): PerformanceFixtureManifest {
  const database = new Database(input.database)
  database.run("PRAGMA foreign_keys = ON")
  const project = database
    .query("SELECT id FROM project WHERE worktree = ?1 ORDER BY time_updated DESC LIMIT 1")
    .get(input.directory) as { id: string } | null
  if (!project) {
    database.close()
    throw new Error(`Performance fixture could not find initialized project for ${input.directory}`)
  }

  const sessions = Array.from({ length: SESSION_COUNT }, (_, index) => ({
    id: `ses_performance_${String(index).padStart(4, "0")}`,
    title: titles[index] ?? `Performance Catalog ${String(index + 1).padStart(3, "0")}`,
    updated: FIXTURE_TIME - index * 1_000,
  }))
  const output = Array.from(
    { length: 4_000 },
    (_, index) => `fixture output ${String(index + 1).padStart(4, "0")} ${"x".repeat(72)}`,
  ).join("\n")
  const diff = [
    "--- a/src/performance-fixture.ts",
    "+++ b/src/performance-fixture.ts",
    "@@ -1,2500 +1,2500 @@",
    ...Array.from({ length: 2_500 }, (_, index) => [
      `-const fixture${String(index).padStart(4, "0")} = "before ${"a".repeat(42)}"`,
      `+const fixture${String(index).padStart(4, "0")} = "after ${"b".repeat(43)}"`,
    ]).flat(),
  ].join("\n")

  const insertProject = database.prepare(
    "INSERT INTO opencodex_project (id, project_id, name, sort_order, time_created, time_updated) VALUES (?1, ?2, ?3, 0, ?4, ?4)",
  )
  const insertFolder = database.prepare(
    "INSERT INTO opencodex_project_folder (path, opencodex_project_id, project_id, time_created, time_updated) VALUES (?1, ?2, ?3, ?4, ?4)",
  )
  const insertSession = database.prepare(`
    INSERT INTO session (
      id, project_id, slug, directory, title, version, metadata, cost,
      tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write,
      time_created, time_updated
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, 0, 0, 0, 0, 0, ?8, ?9)
  `)
  const insertProjectSession = database.prepare(`
    INSERT INTO opencodex_project_session (
      session_id, opencodex_project_id, path, time_created, time_updated
    ) VALUES (?1, ?2, ?3, ?4, ?4)
  `)
  const insertSessionState = database.prepare(`
    INSERT INTO opencodex_session_state (
      session_id, seen_at, reviewed_at, reviewed_files, time_created, time_updated
    ) VALUES (?1, ?2, ?2, '[]', ?2, ?2)
  `)
  const insertMessage = database.prepare(`
    INSERT INTO message (id, session_id, time_created, time_updated, data)
    VALUES (?1, ?2, ?3, ?3, ?4)
  `)
  const insertPart = database.prepare(`
    INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
    VALUES (?1, ?2, ?3, ?4, ?4, ?5)
  `)
  const insertView = database.prepare(`
    INSERT INTO opencodex_view (
      id, title, focused_session_id, layout, sort_order, metadata_json, time_created, time_updated
    ) VALUES (?1, ?2, ?3, ?4, 0, ?5, ?6, ?6)
  `)
  const insertViewSession = database.prepare(`
    INSERT INTO opencodex_view_session (
      view_id, session_id, sort_order, time_created, time_updated
    ) VALUES (?1, ?2, ?3, ?4, ?4)
  `)

  database.transaction(() => {
    insertProject.run(FIXTURE_PROJECT_ID, project.id, "Performance Fixture", FIXTURE_TIME)
    insertFolder.run(input.directory, FIXTURE_PROJECT_ID, project.id, FIXTURE_TIME)
    sessions.forEach((session, index) => {
      insertSession.run(
        session.id,
        project.id,
        session.id,
        input.directory,
        session.title,
        "performance-fixture",
        JSON.stringify({ fixture: "performance" }),
        FIXTURE_TIME - index * 1_000,
        session.updated,
      )
      insertProjectSession.run(session.id, FIXTURE_PROJECT_ID, input.directory, FIXTURE_TIME + index)
      insertSessionState.run(session.id, session.updated + 1)
    })

    const heavySessionID = sessions[2].id
    Array.from({ length: TRANSCRIPT_MESSAGE_COUNT }, (_, index) => {
      const messageID = `msg_performance_${String(index).padStart(4, "0")}`
      const created = FIXTURE_TIME + index
      insertMessage.run(
        messageID,
        heavySessionID,
        created,
        JSON.stringify(assistantMessage(created, "msg_performance_parent")),
      )
      if (index !== TRANSCRIPT_MESSAGE_COUNT - 1) {
        insertPart.run(
          `prt_performance_${String(index).padStart(4, "0")}`,
          messageID,
          heavySessionID,
          created,
          JSON.stringify({
            type: "text",
            text: `Deterministic transcript message ${String(index + 1).padStart(4, "0")}.`,
            time: { start: created, end: created + 1 },
          }),
        )
        return
      }
      insertPart.run(
        "prt_performance_heavy_a_text",
        messageID,
        heavySessionID,
        created,
        JSON.stringify({
          type: "text",
          text: [
            "## Production renderer fixture",
            "",
            "Representative Markdown keeps lists, inline `code`, and fenced highlighting on the measured path.",
            "",
            "```ts",
            "export const bounded = (items: string[]) => items.slice(-128)",
            "```",
          ].join("\n"),
          time: { start: created, end: created + 1 },
        }),
      )
      insertPart.run(
        "prt_performance_heavy_b_tool",
        messageID,
        heavySessionID,
        created,
        JSON.stringify({
          type: "tool",
          callID: "call_performance_heavy",
          tool: "edit",
          state: {
            status: "completed",
            input: { filePath: "src/performance-fixture.ts", oldString: "before", newString: "after" },
            output,
            title: "Rendered bounded output and diff fixture",
            metadata: { diff },
            time: { start: created, end: created + 1 },
          },
        }),
      )
    })

    sessions.slice(0, 8).filter((_, index) => index !== 2).forEach((session, index) => {
      const messageID = `msg_performance_light_${String(index).padStart(2, "0")}`
      const created = FIXTURE_TIME + TRANSCRIPT_MESSAGE_COUNT + index
      insertMessage.run(messageID, session.id, created, JSON.stringify(assistantMessage(created, "msg_performance_parent")))
      insertPart.run(
        `prt_performance_light_${String(index).padStart(2, "0")}`,
        messageID,
        session.id,
        created,
        JSON.stringify({ type: "text", text: `Deterministic session ${index + 1}.`, time: { start: created, end: created + 1 } }),
      )
    })

    insertView.run(
      FIXTURE_VIEW_ID,
      "Performance Eight Pane View",
      sessions[0].id,
      "grid",
      JSON.stringify({ fixture: "performance" }),
      FIXTURE_TIME,
    )
    sessions.slice(0, VIEW_SESSION_COUNT).forEach((session, index) =>
      insertViewSession.run(FIXTURE_VIEW_ID, session.id, index, FIXTURE_TIME + index),
    )
  })()

  const counts = database
    .query(`
      SELECT
        (SELECT COUNT(*) FROM session WHERE metadata = '{"fixture":"performance"}') AS sessions,
        (SELECT COUNT(*) FROM message WHERE session_id = ?1) AS messages,
        (SELECT COUNT(*) FROM opencodex_view_session WHERE view_id = ?2) AS view_sessions
    `)
    .get(sessions[2].id, FIXTURE_VIEW_ID) as { sessions: number; messages: number; view_sessions: number } | null
  database.close()
  if (
    counts?.sessions !== SESSION_COUNT ||
    counts.messages !== TRANSCRIPT_MESSAGE_COUNT ||
    counts.view_sessions !== VIEW_SESSION_COUNT
  ) {
    throw new Error(`Performance fixture verification failed: ${JSON.stringify(counts)}`)
  }

  return {
    sessionCards: SESSION_COUNT,
    initialSessionCards: 100,
    transcriptMessages: TRANSCRIPT_MESSAGE_COUNT,
    liveTailMessages: 128,
    loadMoreMessages: 384,
    remainingMessagesAfterLoadMore: 128,
    viewSessions: VIEW_SESSION_COUNT,
    heavyOutputLines: 4_000,
    heavyDiffLines: 5_003,
  }
}

function assistantMessage(created: number, parentID: string) {
  return {
    role: "assistant",
    time: { created, completed: created + 1 },
    parentID,
    modelID: "performance-model",
    providerID: "performance-provider",
    mode: "build",
    agent: "build",
    path: { cwd: "performance-fixture", root: "performance-fixture" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    finish: "stop",
  }
}
