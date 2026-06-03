import { OpencodeXProject } from "@/opencodex/project"
import { OpencodeXJob } from "@/opencodex/job"
import { OpencodeXSwarm } from "@/opencodex/swarm"
import { OpencodeXView } from "@/opencodex/view"
import { Project } from "@/project/project"
import { SessionID } from "@/session/schema"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { UpdateJobPayload, UpdateProjectPayload, UpdateViewPayload } from "../groups/opencodex"
import { notFound, ProjectNotFoundError } from "../errors"
import * as SessionError from "./session-errors"

function mapErrors<A, R>(effect: Effect.Effect<A, OpencodeXProject.InvalidFolderError | Project.NotFoundError, R>) {
  return effect.pipe(
    Effect.catchTag("OpencodeX.InvalidFolderError", () =>
      Effect.fail(new HttpApiError.BadRequest({})),
    ),
    Effect.catchTag("Project.NotFoundError", (error) =>
      Effect.fail(
        new ProjectNotFoundError({
          projectID: error.projectID,
          message: `Project not found: ${error.projectID}`,
        }),
      ),
    ),
  )
}

function mapProjectNotFound<A, R>(effect: Effect.Effect<A, Project.NotFoundError, R>) {
  return effect.pipe(
    Effect.catchTag("Project.NotFoundError", (error) =>
      Effect.fail(
        new ProjectNotFoundError({
          projectID: error.projectID,
          message: `Project not found: ${error.projectID}`,
        }),
      ),
    ),
  )
}

function mapSwarmCreateErrors<A, R>(effect: Effect.Effect<A, Project.NotFoundError | OpencodeXSwarm.ValidationError, R>) {
  return effect.pipe(
    Effect.catchTag("Project.NotFoundError", (error) =>
      Effect.fail(
        new ProjectNotFoundError({
          projectID: error.projectID,
          message: `Project not found: ${error.projectID}`,
        }),
      ),
    ),
    Effect.catchTag("OpencodeX.Swarm.ValidationError", () => Effect.fail(new HttpApiError.BadRequest({}))),
  )
}

function mapJobNotFound<A, R>(effect: Effect.Effect<A, OpencodeXJob.NotFoundError, R>) {
  return effect.pipe(
    Effect.catchTag("OpencodeX.Job.NotFoundError", (error) => Effect.fail(notFound(`Job not found: ${error.jobID}`))),
  )
}

function mapSwarmNotFound<A, R>(
  effect: Effect.Effect<A, OpencodeXSwarm.NotFoundError | OpencodeXSwarm.RoleNotFoundError | OpencodeXSwarm.ValidationError, R>,
) {
  return effect.pipe(
    Effect.catchTag("OpencodeX.Swarm.NotFoundError", (error) =>
      Effect.fail(notFound(`Swarm not found: ${error.swarmID}`)),
    ),
    Effect.catchTag("OpencodeX.Swarm.RoleNotFoundError", (error) =>
      Effect.fail(notFound(`Swarm role not found: ${error.roleID}`)),
    ),
    Effect.catchTag("OpencodeX.Swarm.ValidationError", () => Effect.fail(new HttpApiError.BadRequest({}))),
  )
}

function mapViewErrors<A, R>(
  effect: Effect.Effect<A, OpencodeXView.NotFoundError | OpencodeXView.ValidationError, R>,
) {
  return effect.pipe(
    Effect.catchTag("OpencodeX.View.NotFoundError", (error) =>
      Effect.fail(notFound(`View not found: ${error.viewID}`)),
    ),
    Effect.catchTag("OpencodeX.View.ValidationError", () => Effect.fail(new HttpApiError.BadRequest({}))),
  )
}

export const opencodexHandlers = HttpApiBuilder.group(InstanceHttpApi, "opencodex", (handlers) =>
  Effect.gen(function* () {
    const service = yield* OpencodeXProject.Service
    const jobs = yield* OpencodeXJob.Service
    const swarms = yield* OpencodeXSwarm.Service
    const views = yield* OpencodeXView.Service

    const listProjects = Effect.fn("OpencodeXHttpApi.listProjects")(function* () {
      return yield* service.list()
    })

    const createProject = Effect.fn("OpencodeXHttpApi.createProject")(function* (ctx: {
      payload: OpencodeXProject.CreateInput
    }) {
      return yield* mapErrors(service.create(ctx.payload))
    })

    const validateProject = Effect.fn("OpencodeXHttpApi.validateProject")(function* (ctx: {
      payload: OpencodeXProject.ValidateInput
    }) {
      return yield* service.validate(ctx.payload)
    })

    const updateProject = Effect.fn("OpencodeXHttpApi.updateProject")(function* (ctx: {
      params: { projectID: string }
      payload: typeof UpdateProjectPayload.Type
    }) {
      return yield* mapErrors(service.update({ ...ctx.payload, projectID: ctx.params.projectID }))
    })

    const reorderProjects = Effect.fn("OpencodeXHttpApi.reorderProjects")(function* (ctx: {
      payload: OpencodeXProject.ReorderInput
    }) {
      return yield* service.reorder(ctx.payload)
    })

    const createSession = Effect.fn("OpencodeXHttpApi.createSession")(function* (ctx: {
      payload: OpencodeXProject.CreateSessionInput
    }) {
      return yield* mapErrors(service.createSession(ctx.payload))
    })

    const moveSession = Effect.fn("OpencodeXHttpApi.moveSession")(function* (ctx: {
      payload: OpencodeXProject.MoveSessionInput
    }) {
      return yield* service.moveSession(ctx.payload).pipe(
        Effect.catchTag("Project.NotFoundError", (error) =>
          Effect.fail(
            new ProjectNotFoundError({
              projectID: error.projectID,
              message: `Project not found: ${error.projectID}`,
            }),
          ),
        ),
        Effect.catchTag("NotFoundError", (error) => Effect.fail(notFound(error.message))),
      )
    })

    const removeSession = Effect.fn("OpencodeXHttpApi.removeSession")(function* (ctx: {
      params: { sessionID: SessionID }
    }) {
      yield* SessionError.mapStorageNotFound(service.removeSession(ctx.params.sessionID))
      return true
    })

    const removeProject = Effect.fn("OpencodeXHttpApi.removeProject")(function* (ctx: {
      params: { projectID: string }
    }) {
      return yield* service.removeProject(ctx.params.projectID)
    })

    const listJobs = Effect.fn("OpencodeXHttpApi.listJobs")(function* () {
      return yield* jobs.list()
    })

    const createJob = Effect.fn("OpencodeXHttpApi.createJob")(function* (ctx: {
      payload: OpencodeXJob.CreateInput
    }) {
      return yield* jobs.create(ctx.payload)
    })

    const getJob = Effect.fn("OpencodeXHttpApi.getJob")(function* (ctx: {
      params: { jobID: string }
    }) {
      return yield* mapJobNotFound(jobs.get(ctx.params.jobID))
    })

    const updateJob = Effect.fn("OpencodeXHttpApi.updateJob")(function* (ctx: {
      params: { jobID: string }
      payload: typeof UpdateJobPayload.Type
    }) {
      return yield* mapJobNotFound(jobs.update({ ...ctx.payload, id: ctx.params.jobID }))
    })

    const cancelJob = Effect.fn("OpencodeXHttpApi.cancelJob")(function* (ctx: {
      params: { jobID: string }
    }) {
      return yield* mapJobNotFound(jobs.cancel(ctx.params.jobID))
    })

    const listSwarms = Effect.fn("OpencodeXHttpApi.listSwarms")(function* () {
      return yield* swarms.list()
    })

    const createSwarm = Effect.fn("OpencodeXHttpApi.createSwarm")(function* (ctx: {
      payload: OpencodeXSwarm.CreateInput
    }) {
      return yield* mapSwarmCreateErrors(swarms.create(ctx.payload))
    })

    const getSwarm = Effect.fn("OpencodeXHttpApi.getSwarm")(function* (ctx: {
      params: { swarmID: string }
    }) {
      return yield* mapSwarmNotFound(swarms.get(ctx.params.swarmID))
    })

    const updateSwarm = Effect.fn("OpencodeXHttpApi.updateSwarm")(function* (ctx: {
      params: { swarmID: string }
      payload: OpencodeXSwarm.UpdateInput
    }) {
      return yield* mapSwarmNotFound(swarms.update(ctx.params.swarmID, ctx.payload))
    })

    const startSwarm = Effect.fn("OpencodeXHttpApi.startSwarm")(function* (ctx: {
      params: { swarmID: string }
    }) {
      return yield* mapSwarmNotFound(swarms.start(ctx.params.swarmID))
    })

    const assignSwarmTask = Effect.fn("OpencodeXHttpApi.assignSwarmTask")(function* (ctx: {
      params: { swarmID: string }
      payload: OpencodeXSwarm.AssignTaskInput
    }) {
      return yield* mapSwarmNotFound(swarms.assignTask(ctx.params.swarmID, ctx.payload))
    })

    const cancelSwarm = Effect.fn("OpencodeXHttpApi.cancelSwarm")(function* (ctx: {
      params: { swarmID: string }
    }) {
      return yield* mapSwarmNotFound(swarms.cancel(ctx.params.swarmID))
    })

    const removeSwarm = Effect.fn("OpencodeXHttpApi.removeSwarm")(function* (ctx: {
      params: { swarmID: string }
    }) {
      return yield* mapSwarmNotFound(swarms.remove(ctx.params.swarmID))
    })

    const addSwarmRole = Effect.fn("OpencodeXHttpApi.addSwarmRole")(function* (ctx: {
      params: { swarmID: string }
      payload: OpencodeXSwarm.AddRoleInput
    }) {
      return yield* mapSwarmNotFound(swarms.addRole(ctx.params.swarmID, ctx.payload))
    })

    const updateSwarmRole = Effect.fn("OpencodeXHttpApi.updateSwarmRole")(function* (ctx: {
      params: { swarmID: string; roleID: string }
      payload: OpencodeXSwarm.UpdateRoleInput
    }) {
      return yield* mapSwarmNotFound(swarms.updateRole(ctx.params.swarmID, ctx.params.roleID, ctx.payload))
    })

    const listViews = Effect.fn("OpencodeXHttpApi.listViews")(function* () {
      return yield* views.list()
    })

    const createView = Effect.fn("OpencodeXHttpApi.createView")(function* (ctx: {
      payload: OpencodeXView.CreateInput
    }) {
      return yield* mapViewErrors(
        views.create(ctx.payload).pipe(Effect.catchTag("NotFoundError", () => Effect.fail(new OpencodeXView.ValidationError({ message: "Session not found." })))),
      )
    })

    const reorderViews = Effect.fn("OpencodeXHttpApi.reorderViews")(function* (ctx: {
      payload: OpencodeXView.ReorderInput
    }) {
      return yield* views.reorder(ctx.payload)
    })

    const getView = Effect.fn("OpencodeXHttpApi.getView")(function* (ctx: {
      params: { viewID: string }
    }) {
      return yield* mapViewErrors(views.get(ctx.params.viewID))
    })

    const updateView = Effect.fn("OpencodeXHttpApi.updateView")(function* (ctx: {
      params: { viewID: string }
      payload: typeof UpdateViewPayload.Type
    }) {
      return yield* mapViewErrors(
        views
          .update({ ...ctx.payload, id: ctx.params.viewID })
          .pipe(Effect.catchTag("NotFoundError", () => Effect.fail(new OpencodeXView.ValidationError({ message: "Session not found." })))),
      )
    })

    const removeView = Effect.fn("OpencodeXHttpApi.removeView")(function* (ctx: {
      params: { viewID: string }
    }) {
      return yield* mapViewErrors(views.remove(ctx.params.viewID))
    })

    return handlers
      .handle("listProjects", listProjects)
      .handle("createProject", createProject)
      .handle("validateProject", validateProject)
      .handle("updateProject", updateProject)
      .handle("reorderProjects", reorderProjects)
      .handle("createSession", createSession)
      .handle("moveSession", moveSession)
      .handle("removeSession", removeSession)
      .handle("removeProject", removeProject)
      .handle("listJobs", listJobs)
      .handle("createJob", createJob)
      .handle("getJob", getJob)
      .handle("updateJob", updateJob)
      .handle("cancelJob", cancelJob)
      .handle("listSwarms", listSwarms)
      .handle("createSwarm", createSwarm)
      .handle("getSwarm", getSwarm)
      .handle("updateSwarm", updateSwarm)
      .handle("startSwarm", startSwarm)
      .handle("assignSwarmTask", assignSwarmTask)
      .handle("cancelSwarm", cancelSwarm)
      .handle("removeSwarm", removeSwarm)
      .handle("addSwarmRole", addSwarmRole)
      .handle("updateSwarmRole", updateSwarmRole)
      .handle("listViews", listViews)
      .handle("createView", createView)
      .handle("reorderViews", reorderViews)
      .handle("getView", getView)
      .handle("updateView", updateView)
      .handle("removeView", removeView)
  }),
)
