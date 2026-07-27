import { Effect } from "effect"
import { array, check, isRecord, object } from "./assertions"
import { call } from "./backend"
import { http, route } from "./dsl"
import { seedRequest } from "./opencodex-operation-scenarios"
import type { ActiveScenario, Scenario, ScenarioContext } from "./types"

const TERMINAL_SESSION = "/experimental/opencodex/terminal-session"
const BY_ID = `${TERMINAL_SESSION}/{terminalSessionID}`
/* The route rejects anything that is not a UUID, so this cannot be a label. */
const installationID = "6f1c1e64-3a1a-4f7e-9b2a-0f5d9c1b7e21"
const missingID = "opx_term_httpapi_missing"

export const opencodexTerminalSessionScenarios: Scenario[] = [
  http.protected
    .get(TERMINAL_SESSION, "opencodex.terminal_session.list")
    .seeded((ctx) => seedTerminalSession(ctx, "list"))
    .json(200, (body, ctx) => {
      array(body)
      check(
        body.some((item) => isRecord(item) && item.id === ctx.state.id),
        "terminal session list should include the seeded session",
      )
    }),
  http.protected
    .post(TERMINAL_SESSION, "opencodex.terminal_session.create")
    .mutating()
    .at((ctx) => ({
      path: TERMINAL_SESSION,
      headers: ctx.headers(),
      body: { title: "HTTP API create terminal", directory: ctx.directory ?? "", installationID },
    }))
    .json(200, (body, ctx) => {
      object(body)
      check(body.title === "HTTP API create terminal", "create should keep the requested title")
      check(body.directory === ctx.directory, "create should record the scenario directory")
      check(body.installationID === installationID, "create should record the installation")
      /* The headless driver mirrors a session in later, so only the resume
         handle is guaranteed here - assert it exists, not what it points at. */
      check(typeof body.resumeID === "string" && body.resumeID.length > 0, "create should issue a resume handle")
    }),
  http.protected
    .get(BY_ID, "opencodex.terminal_session.get")
    .seeded((ctx) => seedTerminalSession(ctx, "get"))
    .at((ctx) => ({
      path: route(BY_ID, { terminalSessionID: ctx.state.id }),
      headers: ctx.headers(),
    }))
    .json(200, (body, ctx) => {
      object(body)
      check(body.id === ctx.state.id, "get should return the seeded terminal session")
      check(body.installationID === installationID, "get should carry the seeded installation")
    }),
  http.protected
    .patch(BY_ID, "opencodex.terminal_session.update")
    .mutating()
    .seeded((ctx) => seedTerminalSession(ctx, "update"))
    .at((ctx) => ({
      path: route(BY_ID, { terminalSessionID: ctx.state.id }),
      headers: ctx.headers(),
      body: { expectedTimeUpdated: ctx.state.timeUpdated, title: "HTTP API renamed terminal" },
    }))
    .json(200, (body, ctx) => {
      object(body)
      check(body.id === ctx.state.id, "update should return the seeded terminal session")
      check(body.title === "HTTP API renamed terminal", "update should apply the title")
      check(
        typeof body.timeUpdated === "number" && body.timeUpdated >= ctx.state.timeUpdated,
        "update should carry the optimistic concurrency stamp forward",
      )
    }),
  /*
   * Update is the only terminal-session route carrying ConflictError, and a
   * stale stamp is why it exists: the GUI renames a terminal from a snapshot it
   * may have held for a while. Cover the rejection, not just the accept.
   */
  http.protected
    .patch(BY_ID, "opencodex.terminal_session.update")
    .mutating()
    .seeded((ctx) => seedTerminalSession(ctx, "conflict"))
    .at((ctx) => ({
      path: route(BY_ID, { terminalSessionID: ctx.state.id }),
      headers: ctx.headers(),
      body: { expectedTimeUpdated: 1, title: "HTTP API stale terminal" },
    }))
    .json(409, object, "status"),
  http.protected
    .post(`${BY_ID}/opened`, "opencodex.terminal_session.opened")
    .mutating()
    .seeded((ctx) => seedTerminalSession(ctx, "opened"))
    .at((ctx) => ({
      path: `${route(BY_ID, { terminalSessionID: ctx.state.id })}/opened`,
      headers: ctx.headers(),
    }))
    .json(200, (body, ctx) => {
      object(body)
      check(body.id === ctx.state.id, "opened should return the seeded terminal session")
      check(typeof body.timeOpened === "number", "opened should stamp the launch time")
    }),
  http.protected
    .delete(BY_ID, "opencodex.terminal_session.delete")
    .mutating()
    .seeded((ctx) => seedTerminalSession(ctx, "delete"))
    .at((ctx) => ({
      path: route(BY_ID, { terminalSessionID: ctx.state.id }),
      headers: ctx.headers(),
    }))
    .jsonEffect(200, (body, ctx) =>
      Effect.gen(function* () {
        check(body === true, "delete should report the terminal session was removed")
        const after = yield* readTerminalSession(ctx, ctx.state.id)
        check(after.status === 404, `deleted terminal session should be gone, got ${after.status}`)
      }),
    ),
  http.protected
    .get(BY_ID, "opencodex.terminal_session.get")
    .at((ctx) => ({
      path: route(BY_ID, { terminalSessionID: missingID }),
      headers: ctx.headers(),
    }))
    .json(404, object, "status"),
]

function seedTerminalSession(ctx: ScenarioContext, name: string) {
  return Effect.gen(function* () {
    const body = yield* seedRequest(ctx, "POST", TERMINAL_SESSION, {
      title: `HTTP API ${name} terminal`,
      directory: ctx.directory ?? "",
      installationID,
    })
    object(body)
    if (typeof body.id !== "string") return yield* Effect.die(new Error("seeded terminal session did not return an id"))
    if (typeof body.timeUpdated !== "number") {
      return yield* Effect.die(new Error("seeded terminal session did not return timeUpdated"))
    }
    return { id: body.id, timeUpdated: body.timeUpdated }
  })
}

/** Reads without asserting 200, so a delete can prove the row is gone. */
function readTerminalSession(ctx: ScenarioContext, terminalSessionID: string) {
  const path = route(BY_ID, { terminalSessionID })
  const scenario: ActiveScenario = {
    kind: "active",
    method: "GET",
    path,
    name: `read ${path}`,
    project: undefined,
    seed: () => Effect.void,
    request: (requestContext) => ({ path, headers: requestContext.headers() }),
    authProbe: undefined,
    expect: () => Effect.void,
    compare: "none",
    capture: "full",
    mutates: false,
    reset: false,
    auth: "protected",
  }
  return call(scenario, { ...ctx, state: undefined })
}
