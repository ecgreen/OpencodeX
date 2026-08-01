import { OpencodeXGoal } from "@/opencodex/goal"
import { OpencodeXJob } from "@/opencodex/job"
import { OpencodeXSwarm } from "@/opencodex/swarm"
import { OpencodeXTerminalSession } from "@/opencodex/terminal-session"
import { OpencodeXView } from "@/opencodex/view"
import { Project } from "@/project/project"
import { Effect } from "effect"
import { HttpApiError } from "effect/unstable/httpapi"
import { ConflictError, notFound, ProjectNotFoundError } from "../errors"
import { UpdateJobPayload, UpdateTerminalSessionPayload, UpdateViewPayload } from "../groups/opencodex"

export const makeOpencodeXOperationsHandlers = Effect.fn("OpencodeXHttpApi.makeOperationsHandlers")(function* () {
  const goals = yield* OpencodeXGoal.Service
  const jobs = yield* OpencodeXJob.Service
  const swarms = yield* OpencodeXSwarm.Service
  const terminalSessions = yield* OpencodeXTerminalSession.Service
  const views = yield* OpencodeXView.Service

  const requireMutableJob = Effect.fn("OpencodeXHttpApi.requireMutableJob")(function* (jobID: string) {
    const job = yield* mapJobErrors(jobs.get(jobID))
    // Jobs the swarm engine or a goal graph owns are driven by their own
    // runtime; letting a client settle one would desynchronise the graph.
    if (job.source !== "swarm" && !job.kind.startsWith("swarm.") && !job.kind.startsWith("goal.")) return job
    return yield* new HttpApiError.BadRequest({})
  })

  const listJobs = Effect.fn("OpencodeXHttpApi.listJobs")(function* () {
    return yield* jobs.list()
  })
  const createJob = Effect.fn("OpencodeXHttpApi.createJob")(function* (ctx: { payload: OpencodeXJob.CreateInput }) {
    if (ctx.payload.source === "swarm" || ctx.payload.kind.startsWith("swarm.") || ctx.payload.kind.startsWith("goal.")) {
      return yield* new HttpApiError.BadRequest({})
    }
    return yield* jobs.create(ctx.payload)
  })
  const getJob = Effect.fn("OpencodeXHttpApi.getJob")(function* (ctx: { params: { jobID: string } }) {
    return yield* mapJobErrors(jobs.get(ctx.params.jobID))
  })
  const updateJob = Effect.fn("OpencodeXHttpApi.updateJob")(function* (ctx: {
    params: { jobID: string }
    payload: typeof UpdateJobPayload.Type
  }) {
    yield* requireMutableJob(ctx.params.jobID)
    return yield* mapJobErrors(jobs.update({ ...ctx.payload, id: ctx.params.jobID }))
  })
  const cancelJob = Effect.fn("OpencodeXHttpApi.cancelJob")(function* (ctx: { params: { jobID: string } }) {
    yield* requireMutableJob(ctx.params.jobID)
    return yield* mapJobErrors(jobs.cancel(ctx.params.jobID))
  })
  const claimJob = Effect.fn("OpencodeXHttpApi.claimJob")(function* (ctx: {
    params: { jobID: string }
    payload: Omit<OpencodeXJob.ClaimInput, "jobID">
  }) {
    yield* requireMutableJob(ctx.params.jobID)
    return yield* mapJobErrors(jobs.claim({ ...ctx.payload, jobID: ctx.params.jobID }))
  })
  const startJob = Effect.fn("OpencodeXHttpApi.startJob")(function* (ctx: {
    params: { jobID: string }
    payload: { owner: string }
  }) {
    yield* requireMutableJob(ctx.params.jobID)
    return yield* mapJobErrors(jobs.start(ctx.params.jobID, ctx.payload.owner))
  })
  const renewJob = Effect.fn("OpencodeXHttpApi.renewJob")(function* (ctx: {
    params: { jobID: string }
    payload: Omit<OpencodeXJob.ClaimInput, "jobID">
  }) {
    yield* requireMutableJob(ctx.params.jobID)
    return yield* mapJobErrors(jobs.renew({ ...ctx.payload, jobID: ctx.params.jobID }))
  })
  const succeedJob = Effect.fn("OpencodeXHttpApi.succeedJob")(function* (ctx: {
    params: { jobID: string }
    payload: Omit<OpencodeXJob.CompleteInput, "jobID">
  }) {
    yield* requireMutableJob(ctx.params.jobID)
    return yield* mapJobErrors(jobs.succeed({ ...ctx.payload, jobID: ctx.params.jobID }))
  })
  const failJob = Effect.fn("OpencodeXHttpApi.failJob")(function* (ctx: {
    params: { jobID: string }
    payload: Omit<OpencodeXJob.FailInput, "jobID">
  }) {
    yield* requireMutableJob(ctx.params.jobID)
    return yield* mapJobErrors(jobs.fail({ ...ctx.payload, jobID: ctx.params.jobID }))
  })
  const retryJob = Effect.fn("OpencodeXHttpApi.retryJob")(function* (ctx: { params: { jobID: string } }) {
    yield* requireMutableJob(ctx.params.jobID)
    return yield* mapJobErrors(jobs.retry(ctx.params.jobID))
  })

  const listSwarms = Effect.fn("OpencodeXHttpApi.listSwarms")(function* () {
    return yield* swarms.list()
  })
  const createSwarm = Effect.fn("OpencodeXHttpApi.createSwarm")(function* (ctx: {
    payload: OpencodeXSwarm.CreateInput
  }) {
    return yield* mapSwarmCreateErrors(swarms.create(ctx.payload))
  })
  const getSwarm = Effect.fn("OpencodeXHttpApi.getSwarm")(function* (ctx: { params: { swarmID: string } }) {
    return yield* mapSwarmErrors(swarms.get(ctx.params.swarmID))
  })
  const updateSwarm = Effect.fn("OpencodeXHttpApi.updateSwarm")(function* (ctx: {
    params: { swarmID: string }
    payload: OpencodeXSwarm.UpdateInput
  }) {
    return yield* mapSwarmErrors(swarms.update(ctx.params.swarmID, ctx.payload))
  })
  const cancelSwarm =Effect.fn("OpencodeXHttpApi.cancelSwarm")(function* (ctx: { params: { swarmID: string } }) {
    return yield* mapSwarmErrors(swarms.cancel(ctx.params.swarmID))
  })
  const removeSwarm = Effect.fn("OpencodeXHttpApi.removeSwarm")(function* (ctx: { params: { swarmID: string } }) {
    return yield* mapSwarmErrors(swarms.remove(ctx.params.swarmID))
  })
  const addSwarmRole = Effect.fn("OpencodeXHttpApi.addSwarmRole")(function* (ctx: {
    params: { swarmID: string }
    payload: OpencodeXSwarm.AddRoleInput
  }) {
    return yield* mapSwarmErrors(swarms.addRole(ctx.params.swarmID, ctx.payload))
  })
  const updateSwarmRole = Effect.fn("OpencodeXHttpApi.updateSwarmRole")(function* (ctx: {
    params: { swarmID: string; roleID: string }
    payload: OpencodeXSwarm.UpdateRoleInput
  }) {
    return yield* mapSwarmErrors(swarms.updateRole(ctx.params.swarmID, ctx.params.roleID, ctx.payload))
  })

  const listGoals = Effect.fn("OpencodeXHttpApi.listGoals")(function* (ctx: {
    query: { projectID?: string; sessionID?: string }
  }) {
    return yield* goals.list({ projectID: ctx.query.projectID, sessionID: ctx.query.sessionID })
  })
  const createGoal = Effect.fn("OpencodeXHttpApi.createGoal")(function* (ctx: {
    payload: OpencodeXGoal.CreateInput
  }) {
    return yield* goals.create(ctx.payload).pipe(
      Effect.catchTag("Project.NotFoundError", (error) =>
        Effect.fail(
          new ProjectNotFoundError({ projectID: error.projectID, message: `Project not found: ${error.projectID}` }),
        ),
      ),
      Effect.catchTag("OpencodeX.Goal.ValidationError", () => Effect.fail(new HttpApiError.BadRequest({}))),
    )
  })
  const getGoal = Effect.fn("OpencodeXHttpApi.getGoal")(function* (ctx: { params: { goalID: string } }) {
    return yield* mapGoalErrors(goals.get(ctx.params.goalID))
  })
  const planGoal = Effect.fn("OpencodeXHttpApi.planGoal")(function* (ctx: {
    params: { goalID: string }
    payload: OpencodeXGoal.PlanInput
  }) {
    return yield* mapGoalErrors(goals.plan(ctx.params.goalID, ctx.payload))
  })
  const updateGoalPlan = Effect.fn("OpencodeXHttpApi.updateGoalPlan")(function* (ctx: {
    params: { goalID: string }
    payload: OpencodeXGoal.UpdatePlanInput
  }) {
    return yield* mapGoalErrors(goals.updatePlan(ctx.params.goalID, ctx.payload))
  })
  const startGoal = Effect.fn("OpencodeXHttpApi.startGoal")(function* (ctx: { params: { goalID: string } }) {
    return yield* mapGoalErrors(goals.start(ctx.params.goalID))
  })
  const approveGoalNode = Effect.fn("OpencodeXHttpApi.approveGoalNode")(function* (ctx: {
    params: { goalID: string; nodeID: string }
    payload: { approved: boolean }
  }) {
    return yield* mapGoalErrors(goals.approve(ctx.params.goalID, ctx.params.nodeID, ctx.payload.approved))
  })
  const cancelGoal = Effect.fn("OpencodeXHttpApi.cancelGoal")(function* (ctx: { params: { goalID: string } }) {
    return yield* mapGoalErrors(goals.cancel(ctx.params.goalID))
  })
  const removeGoal = Effect.fn("OpencodeXHttpApi.removeGoal")(function* (ctx: { params: { goalID: string } }) {
    return yield* mapGoalErrors(goals.remove(ctx.params.goalID))
  })

  const listTerminalSessions = Effect.fn("OpencodeXHttpApi.listTerminalSessions")(function* () {
    return yield* terminalSessions.list()
  })
  const createTerminalSession = Effect.fn("OpencodeXHttpApi.createTerminalSession")(function* (ctx: {
    payload: OpencodeXTerminalSession.CreateInput
  }) {
    return yield* terminalSessions
      .create(ctx.payload)
      .pipe(
        Effect.catchTag("OpencodeX.TerminalSession.ValidationError", () =>
          Effect.fail(new HttpApiError.BadRequest({})),
        ),
      )
  })
  const getTerminalSession = Effect.fn("OpencodeXHttpApi.getTerminalSession")(function* (ctx: {
    params: { terminalSessionID: string }
  }) {
    return yield* mapTerminalSessionErrors(terminalSessions.get(ctx.params.terminalSessionID))
  })
  const updateTerminalSession = Effect.fn("OpencodeXHttpApi.updateTerminalSession")(function* (ctx: {
    params: { terminalSessionID: string }
    payload: typeof UpdateTerminalSessionPayload.Type
  }) {
    return yield* mapTerminalSessionUpdateErrors(
      terminalSessions.update({ ...ctx.payload, id: ctx.params.terminalSessionID }),
    )
  })
  const openTerminalSession = Effect.fn("OpencodeXHttpApi.openTerminalSession")(function* (ctx: {
    params: { terminalSessionID: string }
  }) {
    return yield* mapTerminalSessionErrors(terminalSessions.opened(ctx.params.terminalSessionID))
  })
  const removeTerminalSession = Effect.fn("OpencodeXHttpApi.removeTerminalSession")(function* (ctx: {
    params: { terminalSessionID: string }
  }) {
    return yield* mapTerminalSessionErrors(terminalSessions.remove(ctx.params.terminalSessionID))
  })

  const listViews = Effect.fn("OpencodeXHttpApi.listViews")(function* () {
    return yield* views.list()
  })
  const createView = Effect.fn("OpencodeXHttpApi.createView")(function* (ctx: { payload: OpencodeXView.CreateInput }) {
    return yield* views.create(ctx.payload).pipe(
      Effect.catchTag("NotFoundError", () => Effect.fail(new OpencodeXView.ValidationError({ message: "Session not found." }))),
      Effect.catchTag("OpencodeX.TerminalSession.NotFoundError", () =>
        Effect.fail(new OpencodeXView.ValidationError({ message: "Terminal session not found." })),
      ),
      Effect.catchTag("OpencodeX.View.ValidationError", () => Effect.fail(new HttpApiError.BadRequest({}))),
    )
  })
  const reorderViews = Effect.fn("OpencodeXHttpApi.reorderViews")(function* (ctx: {
    payload: OpencodeXView.ReorderInput
  }) {
    return yield* views.reorder(ctx.payload)
  })
  const getView = Effect.fn("OpencodeXHttpApi.getView")(function* (ctx: { params: { viewID: string } }) {
    return yield* mapViewErrors(views.get(ctx.params.viewID))
  })
  const updateView = Effect.fn("OpencodeXHttpApi.updateView")(function* (ctx: {
    params: { viewID: string }
    payload: typeof UpdateViewPayload.Type
  }) {
    return yield* mapViewUpdateErrors(
      views
        .update({ ...ctx.payload, id: ctx.params.viewID })
        .pipe(
          Effect.catchTag("NotFoundError", () => Effect.fail(new OpencodeXView.ValidationError({ message: "Session not found." }))),
          Effect.catchTag("OpencodeX.TerminalSession.NotFoundError", () =>
            Effect.fail(new OpencodeXView.ValidationError({ message: "Terminal session not found." })),
          ),
        ),
    )
  })
  const removeView = Effect.fn("OpencodeXHttpApi.removeView")(function* (ctx: { params: { viewID: string } }) {
    return yield* mapViewErrors(views.remove(ctx.params.viewID))
  })

  return {
    listJobs,
    createJob,
    getJob,
    updateJob,
    cancelJob,
    claimJob,
    startJob,
    renewJob,
    succeedJob,
    failJob,
    retryJob,
    listSwarms,
    createSwarm,
    getSwarm,
    updateSwarm,
    cancelSwarm,
    removeSwarm,
    addSwarmRole,
    updateSwarmRole,
    listGoals,
    createGoal,
    getGoal,
    planGoal,
    updateGoalPlan,
    startGoal,
    approveGoalNode,
    cancelGoal,
    removeGoal,
    listTerminalSessions,
    createTerminalSession,
    getTerminalSession,
    updateTerminalSession,
    openTerminalSession,
    removeTerminalSession,
    listViews,
    createView,
    reorderViews,
    getView,
    updateView,
    removeView,
  }
})

function mapJobErrors<A, R>(effect: Effect.Effect<A, OpencodeXJob.NotFoundError | OpencodeXJob.TransitionError, R>) {
  return effect.pipe(
    Effect.catchTag("OpencodeX.Job.NotFoundError", (error) => Effect.fail(notFound(`Job not found: ${error.jobID}`))),
    Effect.catchTag("OpencodeX.Job.TransitionError", () => Effect.fail(new HttpApiError.BadRequest({}))),
  )
}

function mapSwarmCreateErrors<A, R>(effect: Effect.Effect<A, Project.NotFoundError | OpencodeXSwarm.ValidationError, R>) {
  return effect.pipe(
    Effect.catchTag("Project.NotFoundError", (error) =>
      Effect.fail(new ProjectNotFoundError({ projectID: error.projectID, message: `Project not found: ${error.projectID}` })),
    ),
    Effect.catchTag("OpencodeX.Swarm.ValidationError", () => Effect.fail(new HttpApiError.BadRequest({}))),
  )
}

function mapSwarmErrors<A, R>(
  effect: Effect.Effect<
    A,
    OpencodeXSwarm.NotFoundError | OpencodeXSwarm.RoleNotFoundError | OpencodeXSwarm.ValidationError,
    R
  >,
) {
  return effect.pipe(
    Effect.catchTag("OpencodeX.Swarm.NotFoundError", (error) => Effect.fail(notFound(`Swarm not found: ${error.swarmID}`))),
    Effect.catchTag("OpencodeX.Swarm.RoleNotFoundError", (error) => Effect.fail(notFound(`Swarm role not found: ${error.roleID}`))),
    Effect.catchTag("OpencodeX.Swarm.ValidationError", () => Effect.fail(new HttpApiError.BadRequest({}))),
  )
}

function mapGoalErrors<A, R>(
  effect: Effect.Effect<
    A,
    OpencodeXGoal.NotFoundError | OpencodeXGoal.NodeNotFoundError | OpencodeXGoal.ValidationError,
    R
  >,
) {
  return effect.pipe(
    Effect.catchTag("OpencodeX.Goal.NotFoundError", (error) => Effect.fail(notFound(`Goal not found: ${error.goalID}`))),
    Effect.catchTag("OpencodeX.Goal.NodeNotFoundError", (error) =>
      Effect.fail(notFound(`Goal node not found: ${error.nodeID}`)),
    ),
    Effect.catchTag("OpencodeX.Goal.ValidationError", () => Effect.fail(new HttpApiError.BadRequest({}))),
  )
}

function mapTerminalSessionErrors<A, R>(
  effect: Effect.Effect<
    A,
    OpencodeXTerminalSession.NotFoundError | OpencodeXTerminalSession.ValidationError,
    R
  >,
) {
  return effect.pipe(
    Effect.catchTag("OpencodeX.TerminalSession.NotFoundError", (error) =>
      Effect.fail(notFound(`Terminal session not found: ${error.terminalSessionID}`)),
    ),
    Effect.catchTag("OpencodeX.TerminalSession.ValidationError", () => Effect.fail(new HttpApiError.BadRequest({}))),
  )
}

function mapTerminalSessionUpdateErrors<A, R>(
  effect: Effect.Effect<
    A,
    | OpencodeXTerminalSession.NotFoundError
    | OpencodeXTerminalSession.ValidationError
    | OpencodeXTerminalSession.ConflictError,
    R
  >,
) {
  return effect.pipe(
    Effect.catchTag("OpencodeX.TerminalSession.NotFoundError", (error) =>
      Effect.fail(notFound(`Terminal session not found: ${error.terminalSessionID}`)),
    ),
    Effect.catchTag("OpencodeX.TerminalSession.ValidationError", () => Effect.fail(new HttpApiError.BadRequest({}))),
    Effect.catchTag("OpencodeX.TerminalSession.ConflictError", (error) =>
      Effect.fail(
        new ConflictError({
          message: "The terminal session changed before this update was applied.",
          resource: error.terminalSessionID,
        }),
      ),
    ),
  )
}

function mapViewUpdateErrors<A, R>(
  effect: Effect.Effect<
    A,
    OpencodeXView.NotFoundError | OpencodeXView.ValidationError | OpencodeXView.ConflictError,
    R
  >,
) {
  return effect.pipe(
    Effect.catchTag("OpencodeX.View.NotFoundError", (error) => Effect.fail(notFound(`View not found: ${error.viewID}`))),
    Effect.catchTag("OpencodeX.View.ValidationError", () => Effect.fail(new HttpApiError.BadRequest({}))),
    Effect.catchTag("OpencodeX.View.ConflictError", (error) =>
      Effect.fail(
        new ConflictError({ message: "The view changed before this update was applied.", resource: error.viewID }),
      ),
    ),
  )
}

function mapViewErrors<A, R>(effect: Effect.Effect<A, OpencodeXView.NotFoundError | OpencodeXView.ValidationError, R>) {
  return effect.pipe(
    Effect.catchTag("OpencodeX.View.NotFoundError", (error) => Effect.fail(notFound(`View not found: ${error.viewID}`))),
    Effect.catchTag("OpencodeX.View.ValidationError", () => Effect.fail(new HttpApiError.BadRequest({}))),
  )
}
