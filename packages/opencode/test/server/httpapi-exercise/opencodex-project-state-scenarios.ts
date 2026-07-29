import { Effect } from "effect"
import { array, check, isRecord, object } from "./assertions"
import { http, route } from "./dsl"
import type { Scenario } from "./types"

export const opencodexProjectStateScenarios: Scenario[] = [
  http.protected.get("/experimental/opencodex/settings", "opencodex.settings.get").json(200, (body) => {
    object(body)
    check(typeof body.revision === "string", "OpencodeX settings should include a revision")
  }),
  http.protected
    .patch("/experimental/opencodex/settings", "opencodex.settings.update")
    .mutating()
    .at((ctx) => ({
      path: "/experimental/opencodex/settings",
      headers: ctx.headers(),
      body: { permission_mode: "strict", expectedRevision: "stale-httpapi-revision" },
    }))
    .json(409, object, "status"),
  http.protected.get("/experimental/opencodex/project", "opencodex.project.list").json(200, array, "status"),
  http.protected
    .post("/experimental/opencodex/project", "opencodex.project.create")
    .mutating()
    .at((ctx) => ({
      path: "/experimental/opencodex/project",
      headers: ctx.headers(),
      body: { name: "HTTP API OpencodeX Project", folders: [ctx.directory ?? ""] },
    }))
    .json(
      200,
      (body, ctx) => {
        object(body)
        check(body.name === "HTTP API OpencodeX Project", "created project should use the requested name")
        array(body.folders)
        check(
          body.folders.some((folder) => isRecord(folder) && folder.path === ctx.directory),
          "created project should include the scenario directory",
        )
      },
      "status",
    ),
  http.protected
    .post("/experimental/opencodex/project/validate", "opencodex.project.validate")
    .at((ctx) => ({
      path: "/experimental/opencodex/project/validate",
      headers: ctx.headers(),
      body: { folders: [ctx.directory ?? ""] },
    }))
    .json(200, (body, ctx) => {
      object(body)
      check(body.valid === true, "scenario directory should be a valid project folder")
      array(body.folders)
      check(
        body.folders.some((folder) => isRecord(folder) && folder.path === ctx.directory && folder.valid === true),
        "validation should report the scenario directory as valid",
      )
    }),
  http.protected
    .patch("/experimental/opencodex/project/{projectID}", "opencodex.project.update")
    .mutating()
    .at((ctx) => ({
      path: route("/experimental/opencodex/project/{projectID}", { projectID: "opx_httpapi_missing" }),
      headers: ctx.headers(),
      body: { name: "Missing OpencodeX Project" },
    }))
    .json(404, object, "status"),
  http.protected
    .post("/experimental/opencodex/project/reorder", "opencodex.project.reorder")
    .mutating()
    .at((ctx) => ({
      path: "/experimental/opencodex/project/reorder",
      headers: ctx.headers(),
      body: { projectIDs: [] },
    }))
    .json(200, array, "status"),
  http.protected
    .post("/experimental/opencodex/session", "opencodex.session.create")
    .mutating()
    .at((ctx) => ({
      path: "/experimental/opencodex/session",
      headers: ctx.headers(),
      body: {
        projectID: "opx_httpapi_missing",
        directory: ctx.directory ?? "",
        title: "Missing project session",
      },
    }))
    .json(404, object, "status"),
  http.protected
    .get("/experimental/opencodex/state", "opencodex.state.snapshot")
    .seeded((ctx) => ctx.session({ title: "OpencodeX state session" }))
    .json(200, (body, ctx) => {
      object(body)
      object(body.scope)
      check(body.scope.directory === ctx.directory, "state snapshot should use the scenario directory")
      check(typeof body.cursor === "string", "state snapshot should include a cursor")
      object(body.domains)
      object(body.domains.catalog)
      object(body.domains.operations)
      object(body.payloads)
      object(body.payloads.catalog)
      object(body.payloads.catalog.sessionCards)
      array(body.payloads.catalog.sessionCards.items)
      check(
        body.payloads.catalog.sessionCards.items.some((session) => isRecord(session) && session.id === ctx.state.id),
        "state snapshot should include the seeded session card",
      )
      object(body.payloads.operations)
    }),
  http.protected
    .get("/experimental/opencodex/state/operations", "opencodex.state.operations")
    .json(200, (body, ctx) => {
      object(body)
      object(body.scope)
      check(body.scope.directory === ctx.directory, "operations snapshot should use the scenario directory")
      check(typeof body.cursor === "string", "operations snapshot should include a cursor")
      object(body.payload)
      array(body.payload.jobs)
      array(body.payload.swarms)
    }),
  http.protected
    .get("/experimental/opencodex/state/capabilities", "opencodex.state.capabilities")
    .json(200, (body, ctx) => {
      object(body)
      object(body.scope)
      check(body.scope.directory === ctx.directory, "capabilities snapshot should use the scenario directory")
      check(typeof body.revision === "string", "capabilities snapshot should include a revision")
      object(body.payload)
      array(body.payload.agents)
      array(body.payload.commands)
      array(body.payload.plugins)
    }),
  http.protected
    .get("/experimental/opencodex/state/session-card", "opencodex.state.session_cards")
    .seeded((ctx) => ctx.session({ title: "OpencodeX session card" }))
    .at((ctx) => ({
      path: `/experimental/opencodex/state/session-card?${new URLSearchParams({ ids: ctx.state.id })}`,
      headers: ctx.headers(),
    }))
    .json(200, (body, ctx) => {
      object(body)
      array(body.items)
      check(
        body.items.some((session) => isRecord(session) && session.id === ctx.state.id),
        "session-card lookup should return the seeded session",
      )
      check(body.hasMore === false, "exact session-card lookup should not have another page")
      array(body.missing)
      check(body.missing.length === 0, "seeded session card should not be missing")
      object(body.sessionUiState)
    }),
  http.protected
    .get("/experimental/opencodex/state/session/{sessionID}", "opencodex.state.session")
    .seeded((ctx) =>
      Effect.gen(function* () {
        const session = yield* ctx.session({ title: "OpencodeX session snapshot" })
        yield* ctx.message(session.id, { text: "snapshot message" })
        return session
      }),
    )
    .at((ctx) => ({
      path: route("/experimental/opencodex/state/session/{sessionID}", { sessionID: ctx.state.id }),
      headers: ctx.headers(),
    }))
    .json(200, (body, ctx) => {
      object(body)
      object(body.session)
      check(body.session.id === ctx.state.id, "session snapshot should return the seeded session")
      object(body.messages)
      array(body.messages.items)
      check(body.messages.items.length === 1, "session snapshot should include the seeded message")
      array(body.todos)
      array(body.diff)
      object(body.pendingInteractions)
      array(body.pendingInteractions.permissions)
      array(body.pendingInteractions.questions)
    }),
  http.protected
    .get("/experimental/opencodex/state/event", "opencodex.state.event")
    .stream()
    .status(
      200,
      (_ctx, result) =>
        Effect.sync(() => {
          check(result.contentType.includes("text/event-stream"), "OpencodeX state event should be an SSE stream")
          check(result.text.includes('"type":"ready"'), "OpencodeX state event should emit a ready frame")
        }),
      "status",
    ),
  http.protected
    .patch("/experimental/opencodex/session-state/{sessionID}", "opencodex.session_state.update")
    .mutating()
    .seeded((ctx) => ctx.session({ title: "OpencodeX session state" }))
    .at((ctx) => ({
      path: route("/experimental/opencodex/session-state/{sessionID}", { sessionID: ctx.state.id }),
      headers: ctx.headers(),
      body: { seenAt: 10, reviewedFiles: ["src/httpapi.ts"], expectedReviewedFiles: [] },
    }))
    .json(
      200,
      (body, ctx) => {
        object(body)
        check(body.sessionID === ctx.state.id, "session-state update should return the seeded session ID")
        check(body.seenAt === 10, "session-state update should persist seenAt")
        check(
          Array.isArray(body.reviewedFiles) && body.reviewedFiles.includes("src/httpapi.ts"),
          "session-state update should persist reviewed files",
        )
      },
      "status",
    ),
  http.protected
    .post("/experimental/opencodex/session/move", "opencodex.session.move")
    .mutating()
    .seeded((ctx) => ctx.session({ title: "Move from missing project" }))
    .at((ctx) => ({
      path: "/experimental/opencodex/session/move",
      headers: ctx.headers(),
      body: { projectID: "opx_httpapi_missing", sessionID: ctx.state.id },
    }))
    .json(404, object, "status"),
  http.protected
    .delete("/experimental/opencodex/session/{sessionID}", "opencodex.session.delete")
    .mutating()
    .seeded((ctx) => ctx.session({ title: "Delete through OpencodeX" }))
    .at((ctx) => ({
      path: route("/experimental/opencodex/session/{sessionID}", { sessionID: ctx.state.id }),
      headers: ctx.headers(),
    }))
    .jsonEffect(200, (body, ctx) =>
      Effect.gen(function* () {
        check(body === true, "OpencodeX session delete should return true")
        check((yield* ctx.sessionGet(ctx.state.id)) === undefined, "deleted session should not remain in storage")
      }),
    ),
  http.protected
    .delete("/experimental/opencodex/project/{projectID}", "opencodex.project.delete")
    .mutating()
    .at((ctx) => ({
      path: route("/experimental/opencodex/project/{projectID}", { projectID: "opx_httpapi_missing" }),
      headers: ctx.headers(),
    }))
    .json(200, (body) => {
      check(body === true, "OpencodeX project delete should be idempotent")
    }),
]
