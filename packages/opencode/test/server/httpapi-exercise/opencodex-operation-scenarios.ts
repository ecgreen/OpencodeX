import { Effect } from "effect"
import { array, check, isRecord, object } from "./assertions"
import { call } from "./backend"
import { http, route } from "./dsl"
import type { ActiveScenario, Method, Scenario, ScenarioContext } from "./types"

const owner = "httpapi-exercise"
const swarmRoles = [
  {
    name: "Orchestrator",
    skill: "orchestrator",
    instructions: "Coordinate the HTTP API exercise.",
  },
  {
    name: "Engineer",
    skill: "engineer",
    instructions: "Implement the HTTP API exercise.",
    // Roles carry the effort level their model runs at.
    variant: "high",
  },
]

/**
 * A gate-first graph: starting it parks on the gate without dispatching real
 * work, which keeps these scenarios from needing a model to answer a node.
 */
const goalNodes = [
  {
    id: "gate",
    kind: "gate",
    title: "Approve the exercise",
    brief: "A human decides whether the exercise proceeds.",
  },
  {
    id: "survey",
    kind: "task",
    title: "Survey the exercise",
    brief: "Report what the HTTP API exercise covers.",
    executor: { type: "agent", agent: "build" },
  },
]

export const opencodexOperationScenarios: Scenario[] = [
  http.protected
    .get("/experimental/opencodex/job", "opencodex.job.list")
    .seeded((ctx) => seedJob(ctx, "list"))
    .json(200, (body, ctx) => {
      array(body)
      check(
        body.some((item) => isRecord(item) && item.id === ctx.state.id),
        "job list should include seeded job",
      )
    }),
  http.protected
    .post("/experimental/opencodex/job", "opencodex.job.create")
    .mutating()
    .at((ctx) => ({
      path: "/experimental/opencodex/job",
      headers: ctx.headers(),
      body: {
        kind: "httpapi.exercise.create",
        title: "HTTP API created job",
        idempotencyKey: "httpapi-exercise-create",
        maxAttempts: 2,
      },
    }))
    .json(200, (body) => {
      object(body)
      check(body.kind === "httpapi.exercise.create", "created job should preserve its kind")
      check(body.status === "queued", "created job should be queued")
    }),
  http.protected
    .get("/experimental/opencodex/job/{jobID}", "opencodex.job.get")
    .seeded((ctx) => seedJob(ctx, "get"))
    .at((ctx) => ({
      path: route("/experimental/opencodex/job/{jobID}", { jobID: ctx.state.id }),
      headers: ctx.headers(),
    }))
    .json(200, (body, ctx) => {
      object(body)
      check(body.id === ctx.state.id, "job get should return the seeded job")
    }),
  http.protected
    .patch("/experimental/opencodex/job/{jobID}", "opencodex.job.update")
    .mutating()
    .seeded((ctx) => seedJob(ctx, "update"))
    .at((ctx) => ({
      path: route("/experimental/opencodex/job/{jobID}", { jobID: ctx.state.id }),
      headers: ctx.headers(),
      body: { title: "Updated HTTP API job", metadata: { exercised: true } },
    }))
    .json(200, (body, ctx) => {
      object(body)
      check(body.id === ctx.state.id, "job update should return the seeded job")
      check(body.title === "Updated HTTP API job", "job update should apply the title")
    }),
  http.protected
    .post("/experimental/opencodex/job/{jobID}/cancel", "opencodex.job.cancel")
    .mutating()
    .seeded((ctx) => seedJob(ctx, "cancel"))
    .at((ctx) => ({
      path: route("/experimental/opencodex/job/{jobID}/cancel", { jobID: ctx.state.id }),
      headers: ctx.headers(),
    }))
    .json(200, (body, ctx) => {
      object(body)
      check(body.id === ctx.state.id, "job cancel should return the seeded job")
      check(body.status === "cancelled", "queued job cancellation should be terminal")
    }),
  http.protected
    .post("/experimental/opencodex/job/{jobID}/claim", "opencodex.job.claim")
    .mutating()
    .seeded((ctx) => seedJob(ctx, "claim"))
    .at((ctx) => ({
      path: route("/experimental/opencodex/job/{jobID}/claim", { jobID: ctx.state.id }),
      headers: ctx.headers(),
      body: { owner, leaseMs: 30_000 },
    }))
    .json(200, (body, ctx) => {
      object(body)
      check(body.id === ctx.state.id, "job claim should return the seeded job")
      check(body.status === "claimed" && body.leaseOwner === owner, "job claim should establish the lease")
    }),
  http.protected
    .post("/experimental/opencodex/job/{jobID}/start", "opencodex.job.start")
    .mutating()
    .seeded((ctx) => seedClaimedJob(ctx, "start"))
    .at((ctx) => ({
      path: route("/experimental/opencodex/job/{jobID}/start", { jobID: ctx.state.id }),
      headers: ctx.headers(),
      body: { owner },
    }))
    .json(200, (body, ctx) => {
      object(body)
      check(body.id === ctx.state.id, "job start should return the seeded job")
      check(body.status === "running", "claimed job should start")
    }),
  http.protected
    .post("/experimental/opencodex/job/{jobID}/renew", "opencodex.job.renew")
    .mutating()
    .seeded((ctx) => seedClaimedJob(ctx, "renew"))
    .at((ctx) => ({
      path: route("/experimental/opencodex/job/{jobID}/renew", { jobID: ctx.state.id }),
      headers: ctx.headers(),
      body: { owner, leaseMs: 60_000 },
    }))
    .json(200, (body, ctx) => {
      object(body)
      check(body.id === ctx.state.id, "job renew should return the seeded job")
      check(body.status === "claimed" && body.leaseOwner === owner, "job renew should retain the active lease")
    }),
  http.protected
    .post("/experimental/opencodex/job/{jobID}/succeed", "opencodex.job.succeed")
    .mutating()
    .seeded((ctx) => seedRunningJob(ctx, "succeed"))
    .at((ctx) => ({
      path: route("/experimental/opencodex/job/{jobID}/succeed", { jobID: ctx.state.id }),
      headers: ctx.headers(),
      body: { owner, result: { exercised: true } },
    }))
    .json(200, (body, ctx) => {
      object(body)
      check(body.id === ctx.state.id, "job succeed should return the seeded job")
      check(body.status === "succeeded", "running job should succeed")
      check(isRecord(body.result) && body.result.exercised === true, "job succeed should retain its result")
    }),
  http.protected
    .post("/experimental/opencodex/job/{jobID}/fail", "opencodex.job.fail")
    .mutating()
    .seeded((ctx) => seedRunningJob(ctx, "fail"))
    .at((ctx) => ({
      path: route("/experimental/opencodex/job/{jobID}/fail", { jobID: ctx.state.id }),
      headers: ctx.headers(),
      body: {
        owner,
        failure: { code: "HTTPAPI_EXERCISE", message: "Intentional exerciser failure" },
      },
    }))
    .json(200, (body, ctx) => {
      object(body)
      check(body.id === ctx.state.id, "job fail should return the seeded job")
      check(body.status === "failed", "running job should fail")
      check(isRecord(body.failure) && body.failure.code === "HTTPAPI_EXERCISE", "job failure should be typed")
    }),
  http.protected
    .post("/experimental/opencodex/job/{jobID}/retry", "opencodex.job.retry")
    .mutating()
    .seeded((ctx) => seedFailedJob(ctx))
    .at((ctx) => ({
      path: route("/experimental/opencodex/job/{jobID}/retry", { jobID: ctx.state.id }),
      headers: ctx.headers(),
    }))
    .json(200, (body, ctx) => {
      object(body)
      check(body.id === ctx.state.id, "job retry should return the seeded job")
      check(body.status === "queued", "retryable failed job should be requeued")
    }),

  http.protected
    .get("/experimental/opencodex/swarm", "opencodex.swarm.list")
    .seeded((ctx) => seedSwarm(ctx, "list"))
    .json(200, (body, ctx) => {
      array(body)
      check(
        body.some((item) => isRecord(item) && item.id === ctx.state.id),
        "swarm list should include seeded swarm",
      )
    }),
  http.protected
    .post("/experimental/opencodex/swarm", "opencodex.swarm.create")
    .mutating()
    .at((ctx) => ({
      path: "/experimental/opencodex/swarm",
      headers: ctx.headers(),
      // No projectID: a swarm is a model, usable from any session, so it must
      // create without belonging to a project.
      body: {
        title: "HTTP API created swarm",
        roles: swarmRoles,
      },
    }))
    .json(200, (body) => {
      object(body)
      // An absent optional comes back as an explicit null over the wire, not as
      // a missing key, so this is a loose check on purpose.
      check(
        body.projectID == null,
        `a swarm created without a project should stay project-independent, got ${JSON.stringify(body.projectID)}`,
      )
      check(body.title === "HTTP API created swarm", "created swarm should preserve its title")
      check(body.status === "planned", "created swarm should be planned")
      const roles = body.roles
      array(roles)
      const engineer = roles.find((role) => isRecord(role) && role.name === "Engineer")
      check(
        isRecord(engineer) && engineer.variant === "high",
        "a role's effort level should round-trip through create",
      )
    }),
  http.protected
    .get("/experimental/opencodex/swarm/{swarmID}", "opencodex.swarm.get")
    .seeded((ctx) => seedSwarm(ctx, "get"))
    .at((ctx) => ({
      path: route("/experimental/opencodex/swarm/{swarmID}", { swarmID: ctx.state.id }),
      headers: ctx.headers(),
    }))
    .json(200, (body, ctx) => {
      object(body)
      check(body.id === ctx.state.id, "swarm get should return the seeded swarm")
    }),
  http.protected
    .patch("/experimental/opencodex/swarm/{swarmID}", "opencodex.swarm.update")
    .mutating()
    .seeded((ctx) => seedSwarm(ctx, "update"))
    .at((ctx) => ({
      path: route("/experimental/opencodex/swarm/{swarmID}", { swarmID: ctx.state.id }),
      headers: ctx.headers(),
      body: { title: "Updated HTTP API swarm", metadata: { exercised: true } },
    }))
    .json(200, (body, ctx) => {
      object(body)
      check(body.id === ctx.state.id, "swarm update should return the seeded swarm")
      check(body.title === "Updated HTTP API swarm", "swarm update should apply the title")
    }),
  http.protected
    .post("/experimental/opencodex/swarm/{swarmID}/cancel", "opencodex.swarm.cancel")
    .mutating()
    .seeded((ctx) => seedSwarm(ctx, "cancel"))
    .at((ctx) => ({
      path: route("/experimental/opencodex/swarm/{swarmID}/cancel", { swarmID: ctx.state.id }),
      headers: ctx.headers(),
    }))
    .json(200, (body, ctx) => {
      object(body)
      check(body.id === ctx.state.id, "swarm cancel should return the seeded swarm")
      check(body.status === "cancelled", "planned swarm cancellation should be acknowledged")
    }),
  http.protected
    .delete("/experimental/opencodex/swarm/{swarmID}", "opencodex.swarm.delete")
    .mutating()
    .seeded((ctx) => seedSwarm(ctx, "delete"))
    .at((ctx) => ({
      path: route("/experimental/opencodex/swarm/{swarmID}", { swarmID: ctx.state.id }),
      headers: ctx.headers(),
    }))
    .json(200, (body) => {
      check(body === true, "swarm delete should remove an inactive swarm")
    }),
  http.protected
    .post("/experimental/opencodex/swarm/{swarmID}/role", "opencodex.swarm.role.add")
    .mutating()
    .seeded((ctx) => seedSwarm(ctx, "role-add"))
    .at((ctx) => ({
      path: route("/experimental/opencodex/swarm/{swarmID}/role", { swarmID: ctx.state.id }),
      headers: ctx.headers(),
      body: {
        role: {
          name: "Reviewer",
          skill: "reviewer",
          instructions: "Review the HTTP API exercise.",
        },
      },
    }))
    .json(200, (body) => {
      object(body)
      array(body.roles)
      check(
        body.roles.some((item) => isRecord(item) && item.name === "Reviewer"),
        "swarm role should be added",
      )
    }),
  http.protected
    .patch("/experimental/opencodex/swarm/{swarmID}/role/{roleID}", "opencodex.swarm.role.update")
    .mutating()
    .seeded((ctx) => seedSwarm(ctx, "role-update"))
    .at((ctx) => ({
      path: route("/experimental/opencodex/swarm/{swarmID}/role/{roleID}", {
        swarmID: ctx.state.id,
        roleID: ctx.state.roleID,
      }),
      headers: ctx.headers(),
      body: { name: "Updated Engineer", instructions: "Verify the updated HTTP API exercise." },
    }))
    .json(200, (body, ctx) => {
      object(body)
      array(body.roles)
      check(
        body.roles.some((item) => isRecord(item) && item.id === ctx.state.roleID && item.name === "Updated Engineer"),
        "swarm role update should apply the new name",
      )
    }),

  http.protected
    .get("/experimental/opencodex/goal", "opencodex.goal.list")
    .seeded((ctx) => seedGoal(ctx, "list"))
    .json(200, (body, ctx) => {
      array(body)
      check(
        body.some((item) => isRecord(item) && item.id === ctx.state.id),
        "goal list should include seeded goal",
      )
    }),
  http.protected
    .post("/experimental/opencodex/goal", "opencodex.goal.create")
    .mutating()
    .seeded((ctx) => seedOpencodeXProject(ctx, "goal-create"))
    .at((ctx) => ({
      path: "/experimental/opencodex/goal",
      headers: ctx.headers(),
      body: {
        projectID: ctx.state.id,
        statement: "Ship the HTTP API exercise.",
        successCriteria: ["The exercise passes"],
      },
    }))
    .json(200, (body, ctx) => {
      object(body)
      check(body.projectID === ctx.state.id, "created goal should belong to the seeded project")
      check(body.statement === "Ship the HTTP API exercise.", "created goal should preserve its statement")
      check(body.status === "draft", "a goal with no plan yet should be a draft")
    }),
  http.protected
    .get("/experimental/opencodex/goal/{goalID}", "opencodex.goal.get")
    .seeded((ctx) => seedGoal(ctx, "get"))
    .at((ctx) => ({
      path: route("/experimental/opencodex/goal/{goalID}", { goalID: ctx.state.id }),
      headers: ctx.headers(),
    }))
    .json(200, (body, ctx) => {
      object(body)
      check(body.id === ctx.state.id, "goal get should return the seeded goal")
    }),
  http.protected
    .post("/experimental/opencodex/goal/{goalID}/plan", "opencodex.goal.plan")
    .mutating()
    .seeded((ctx) => seedGoal(ctx, "plan"))
    .at((ctx) => ({
      path: route("/experimental/opencodex/goal/{goalID}/plan", { goalID: ctx.state.id }),
      headers: ctx.headers(),
      body: { nodes: goalNodes, edges: [{ from: "gate", to: "survey" }] },
    }))
    .json(200, (body) => {
      object(body)
      check(body.status === "planned", "a goal with a graph should be planned")
      array(body.nodes)
      check(body.nodes.length === goalNodes.length, "plan should persist every node")
    }),
  http.protected
    .patch("/experimental/opencodex/goal/{goalID}/plan", "opencodex.goal.plan.update")
    .mutating()
    .seeded((ctx) => seedPlannedGoal(ctx, "plan-update"))
    .at((ctx) => ({
      path: route("/experimental/opencodex/goal/{goalID}/plan", { goalID: ctx.state.id }),
      headers: ctx.headers(),
      body: { patchNodes: [{ id: "survey", title: "Surveyed the exercise" }] },
    }))
    .json(200, (body) => {
      object(body)
      array(body.nodes)
      check(
        body.nodes.some((item) => isRecord(item) && item.id === "survey" && item.title === "Surveyed the exercise"),
        "plan update should apply the patched title",
      )
    }),
  http.protected
    .post("/experimental/opencodex/goal/{goalID}/start", "opencodex.goal.start")
    .mutating()
    .seeded((ctx) => seedPlannedGoal(ctx, "start"))
    .at((ctx) => ({
      path: route("/experimental/opencodex/goal/{goalID}/start", { goalID: ctx.state.id }),
      headers: ctx.headers(),
    }))
    .json(200, (body) => {
      object(body)
      // The graph's first node is a gate, so starting parks the goal on it.
      check(body.status === "blocked", "starting a graph that opens with a gate should block on it")
    }),
  http.protected
    .post("/experimental/opencodex/goal/{goalID}/node/{nodeID}/approve", "opencodex.goal.node.approve")
    .mutating()
    .seeded((ctx) => seedStartedGoal(ctx, "approve"))
    .at((ctx) => ({
      path: route("/experimental/opencodex/goal/{goalID}/node/{nodeID}/approve", {
        goalID: ctx.state.id,
        nodeID: "gate",
      }),
      headers: ctx.headers(),
      body: { approved: false },
    }))
    .json(200, (body) => {
      object(body)
      array(body.nodes)
      check(
        body.nodes.some((item) => isRecord(item) && item.id === "gate" && item.status === "skipped"),
        "rejecting a gate should skip it",
      )
    }),
  http.protected
    .post("/experimental/opencodex/goal/{goalID}/cancel", "opencodex.goal.cancel")
    .mutating()
    .seeded((ctx) => seedPlannedGoal(ctx, "cancel"))
    .at((ctx) => ({
      path: route("/experimental/opencodex/goal/{goalID}/cancel", { goalID: ctx.state.id }),
      headers: ctx.headers(),
    }))
    .json(200, (body, ctx) => {
      object(body)
      check(body.id === ctx.state.id, "goal cancel should return the seeded goal")
      check(body.status === "cancelled", "goal cancellation should be acknowledged")
    }),
  http.protected
    .delete("/experimental/opencodex/goal/{goalID}", "opencodex.goal.delete")
    .mutating()
    .seeded((ctx) => seedGoal(ctx, "delete"))
    .at((ctx) => ({
      path: route("/experimental/opencodex/goal/{goalID}", { goalID: ctx.state.id }),
      headers: ctx.headers(),
    }))
    .json(200, (body) => {
      check(body === true, "goal delete should remove the goal")
    }),

  http.protected
    .get("/experimental/opencodex/view", "opencodex.view.list")
    .seeded((ctx) => seedView(ctx, "list"))
    .json(200, (body, ctx) => {
      array(body)
      check(
        body.some((item) => isRecord(item) && item.id === ctx.state.id),
        "view list should include seeded view",
      )
    }),
  http.protected
    .post("/experimental/opencodex/view", "opencodex.view.create")
    .mutating()
    .seeded((ctx) => ctx.session({ title: "HTTP API view session" }))
    .at((ctx) => ({
      path: "/experimental/opencodex/view",
      headers: ctx.headers(),
      body: {
        title: "HTTP API created view",
        sessionIDs: [ctx.state.id],
        focusedSessionID: ctx.state.id,
        layout: "columns",
      },
    }))
    .json(200, (body, ctx) => {
      object(body)
      check(body.title === "HTTP API created view", "created view should preserve its title")
      check(
        Array.isArray(body.sessionIDs) && body.sessionIDs[0] === ctx.state.id,
        "created view should contain seeded session",
      )
    }),
  http.protected
    .post("/experimental/opencodex/view/reorder", "opencodex.view.reorder")
    .mutating()
    .seeded((ctx) =>
      Effect.gen(function* () {
        const first = yield* seedView(ctx, "reorder-first")
        const second = yield* seedView(ctx, "reorder-second")
        return { first, second }
      }),
    )
    .at((ctx) => ({
      path: "/experimental/opencodex/view/reorder",
      headers: ctx.headers(),
      body: { viewIDs: [ctx.state.second.id, ctx.state.first.id] },
    }))
    .json(200, (body, ctx) => {
      array(body)
      check(isRecord(body[0]) && body[0].id === ctx.state.second.id, "view reorder should apply requested order")
    }),
  http.protected
    .get("/experimental/opencodex/view/{viewID}", "opencodex.view.get")
    .seeded((ctx) => seedView(ctx, "get"))
    .at((ctx) => ({
      path: route("/experimental/opencodex/view/{viewID}", { viewID: ctx.state.id }),
      headers: ctx.headers(),
    }))
    .json(200, (body, ctx) => {
      object(body)
      check(body.id === ctx.state.id, "view get should return the seeded view")
    }),
  http.protected
    .patch("/experimental/opencodex/view/{viewID}", "opencodex.view.update")
    .mutating()
    .seeded((ctx) => seedView(ctx, "update"))
    .at((ctx) => ({
      path: route("/experimental/opencodex/view/{viewID}", { viewID: ctx.state.id }),
      headers: ctx.headers(),
      body: {
        expectedTimeUpdated: ctx.state.timeUpdated,
        title: "Updated HTTP API view",
        layout: "rows",
      },
    }))
    .json(200, (body, ctx) => {
      object(body)
      check(body.id === ctx.state.id, "view update should return the seeded view")
      check(body.title === "Updated HTTP API view" && body.layout === "rows", "view update should apply changes")
    }),
  http.protected
    .delete("/experimental/opencodex/view/{viewID}", "opencodex.view.delete")
    .mutating()
    .seeded((ctx) => seedView(ctx, "delete"))
    .at((ctx) => ({
      path: route("/experimental/opencodex/view/{viewID}", { viewID: ctx.state.id }),
      headers: ctx.headers(),
    }))
    .json(200, (body) => {
      check(body === true, "view delete should remove the seeded view")
    }),

  http.protected.get("/experimental/opencodex/plugin", "opencodex.plugin.list").json(200, array),
  http.protected
    .post("/experimental/opencodex/plugin/install", "opencodex.plugin.install.empty")
    .mutating()
    .at((ctx) => ({
      path: "/experimental/opencodex/plugin/install",
      headers: ctx.headers(),
      body: { spec: " " },
    }))
    .status(400),
  http.protected
    .patch("/experimental/opencodex/plugin/toggle", "opencodex.plugin.toggle.missing")
    .mutating()
    .at((ctx) => ({
      path: "/experimental/opencodex/plugin/toggle",
      headers: ctx.headers(),
      body: { id: "tui:httpapi:missing", enabled: false },
    }))
    .status(400),
]

export function seedRequest(ctx: ScenarioContext, method: Method, path: string, body?: unknown) {
  const scenario: ActiveScenario = {
    kind: "active",
    method,
    path,
    name: `seed ${method} ${path}`,
    project: undefined,
    seed: () => Effect.void,
    request: (requestContext) => ({ path, headers: requestContext.headers(), body }),
    authProbe: undefined,
    expect: () => Effect.void,
    compare: "none",
    capture: "full",
    mutates: method !== "GET",
    reset: false,
    auth: "protected",
  }
  return call(scenario, { ...ctx, state: undefined }).pipe(
    Effect.map((result) => {
      if (result.status !== 200)
        throw new Error(`seed ${method} ${path} expected 200, got ${result.status}: ${result.text}`)
      return result.body
    }),
  )
}

function seedJob(ctx: ScenarioContext, name: string) {
  return Effect.gen(function* () {
    const body = yield* seedRequest(ctx, "POST", "/experimental/opencodex/job", {
      kind: `httpapi.exercise.${name}`,
      title: `HTTP API ${name} job`,
      idempotencyKey: `httpapi-exercise-${name}`,
      maxAttempts: 2,
    })
    object(body)
    if (typeof body.id !== "string") return yield* Effect.die(new Error("seeded job did not return an id"))
    return { id: body.id }
  })
}

function seedClaimedJob(ctx: ScenarioContext, name: string) {
  return Effect.gen(function* () {
    const job = yield* seedJob(ctx, name)
    yield* seedRequest(ctx, "POST", route("/experimental/opencodex/job/{jobID}/claim", { jobID: job.id }), {
      owner,
      leaseMs: 30_000,
    })
    return job
  })
}

function seedRunningJob(ctx: ScenarioContext, name: string) {
  return Effect.gen(function* () {
    const job = yield* seedClaimedJob(ctx, name)
    yield* seedRequest(ctx, "POST", route("/experimental/opencodex/job/{jobID}/start", { jobID: job.id }), {
      owner,
    })
    return job
  })
}

function seedFailedJob(ctx: ScenarioContext) {
  return Effect.gen(function* () {
    const job = yield* seedRunningJob(ctx, "retry")
    yield* seedRequest(ctx, "POST", route("/experimental/opencodex/job/{jobID}/fail", { jobID: job.id }), {
      owner,
      failure: { code: "HTTPAPI_RETRY", message: "Seed retryable failure" },
    })
    return job
  })
}

function seedOpencodeXProject(ctx: ScenarioContext, name: string) {
  return Effect.gen(function* () {
    if (!ctx.directory) return yield* Effect.die(new Error("OpencodeX project seed requires a directory"))
    const body = yield* seedRequest(ctx, "POST", "/experimental/opencodex/project", {
      name: `HTTP API ${name} project`,
      directory: ctx.directory,
      folders: [ctx.directory],
    })
    object(body)
    if (typeof body.id !== "string")
      return yield* Effect.die(new Error("seeded OpencodeX project did not return an id"))
    return { id: body.id }
  })
}

function seedSwarm(ctx: ScenarioContext, name: string) {
  return Effect.gen(function* () {
    const project = yield* seedOpencodeXProject(ctx, `swarm-${name}`)
    const body = yield* seedRequest(ctx, "POST", "/experimental/opencodex/swarm", {
      projectID: project.id,
      title: `HTTP API ${name} swarm`,
      roles: swarmRoles,
    })
    object(body)
    if (typeof body.id !== "string") return yield* Effect.die(new Error("seeded swarm did not return an id"))
    array(body.roles)
    const role = body.roles.find((item) => isRecord(item) && item.skill !== "orchestrator")
    if (!isRecord(role) || typeof role.id !== "string") {
      return yield* Effect.die(new Error("seeded swarm did not return a worker role"))
    }
    return { id: body.id, roleID: role.id }
  })
}

function seedGoal(ctx: ScenarioContext, name: string) {
  return Effect.gen(function* () {
    const project = yield* seedOpencodeXProject(ctx, `goal-${name}`)
    const body = yield* seedRequest(ctx, "POST", "/experimental/opencodex/goal", {
      projectID: project.id,
      title: `HTTP API ${name} goal`,
      statement: `Exercise the ${name} goal endpoint.`,
    })
    object(body)
    if (typeof body.id !== "string") return yield* Effect.die(new Error("seeded goal did not return an id"))
    return { id: body.id, projectID: project.id }
  })
}

/** A goal whose graph exists, for the endpoints that need nodes to act on. */
function seedPlannedGoal(ctx: ScenarioContext, name: string) {
  return Effect.gen(function* () {
    const goal = yield* seedGoal(ctx, name)
    yield* seedRequest(ctx, "POST", `/experimental/opencodex/goal/${goal.id}/plan`, {
      nodes: goalNodes,
      edges: [{ from: "gate", to: "survey" }],
    })
    return goal
  })
}

/** A started goal, parked on its gate - the only state approval is legal in. */
function seedStartedGoal(ctx: ScenarioContext, name: string) {
  return Effect.gen(function* () {
    const goal = yield* seedPlannedGoal(ctx, name)
    yield* seedRequest(ctx, "POST", `/experimental/opencodex/goal/${goal.id}/start`, undefined)
    return goal
  })
}

function seedView(ctx: ScenarioContext, name: string) {
  return Effect.gen(function* () {
    const session = yield* ctx.session({ title: `HTTP API ${name} view session` })
    const body = yield* seedRequest(ctx, "POST", "/experimental/opencodex/view", {
      title: `HTTP API ${name} view`,
      sessionIDs: [session.id],
      focusedSessionID: session.id,
      layout: "auto",
    })
    object(body)
    if (typeof body.id !== "string" || typeof body.timeUpdated !== "number") {
      return yield* Effect.die(new Error("seeded view did not return its id and update time"))
    }
    return { id: body.id, timeUpdated: body.timeUpdated }
  })
}
