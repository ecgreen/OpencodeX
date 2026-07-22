import { OpencodeXJob } from "@/opencodex/job"
import { OpencodeXSwarm } from "@/opencodex/swarm"
import { OpencodeXView } from "@/opencodex/view"
import { Project } from "@/project/project"
import { Effect } from "effect"
import { HttpApiError } from "effect/unstable/httpapi"
import { ConflictError, notFound, ProjectNotFoundError } from "../errors"
import { UpdateJobPayload, UpdateViewPayload } from "../groups/opencodex"

export const makeOpencodeXOperationsHandlers = Effect.fn("OpencodeXHttpApi.makeOperationsHandlers")(function* () {
  const jobs = yield* OpencodeXJob.Service
  const swarms = yield* OpencodeXSwarm.Service
  const views = yield* OpencodeXView.Service

  const requireMutableJob = Effect.fn("OpencodeXHttpApi.requireMutableJob")(function* (jobID: string) {
    const job = yield* mapJobErrors(jobs.get(jobID))
    if (job.source !== "swarm" && !job.kind.startsWith("swarm.")) return job
    return yield* new HttpApiError.BadRequest({})
  })

  const listJobs = Effect.fn("OpencodeXHttpApi.listJobs")(function* () {
    return yield* jobs.list()
  })
  const createJob = Effect.fn("OpencodeXHttpApi.createJob")(function* (ctx: { payload: OpencodeXJob.CreateInput }) {
    if (ctx.payload.source === "swarm" || ctx.payload.kind.startsWith("swarm.")) {
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
  const startSwarm = Effect.fn("OpencodeXHttpApi.startSwarm")(function* (ctx: { params: { swarmID: string } }) {
    return yield* mapSwarmErrors(swarms.start(ctx.params.swarmID))
  })
  const assignSwarmTask = Effect.fn("OpencodeXHttpApi.assignSwarmTask")(function* (ctx: {
    params: { swarmID: string }
    payload: OpencodeXSwarm.AssignTaskInput
  }) {
    return yield* mapSwarmErrors(swarms.assignTask(ctx.params.swarmID, ctx.payload))
  })
  const cancelSwarm = Effect.fn("OpencodeXHttpApi.cancelSwarm")(function* (ctx: { params: { swarmID: string } }) {
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

  const listViews = Effect.fn("OpencodeXHttpApi.listViews")(function* () {
    return yield* views.list()
  })
  const createView = Effect.fn("OpencodeXHttpApi.createView")(function* (ctx: { payload: OpencodeXView.CreateInput }) {
    return yield* views.create(ctx.payload).pipe(
      Effect.catchTag("NotFoundError", () => Effect.fail(new OpencodeXView.ValidationError({ message: "Session not found." }))),
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
    startSwarm,
    assignSwarmTask,
    cancelSwarm,
    removeSwarm,
    addSwarmRole,
    updateSwarmRole,
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
