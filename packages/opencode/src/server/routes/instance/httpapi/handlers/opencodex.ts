import { OpencodeXProject } from "@/opencodex/project"
import { Project } from "@/project/project"
import { SessionID } from "@/session/schema"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { UpdateProjectPayload } from "../groups/opencodex"
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

export const opencodexHandlers = HttpApiBuilder.group(InstanceHttpApi, "opencodex", (handlers) =>
  Effect.gen(function* () {
    const service = yield* OpencodeXProject.Service

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

    return handlers
      .handle("listProjects", listProjects)
      .handle("createProject", createProject)
      .handle("validateProject", validateProject)
      .handle("updateProject", updateProject)
      .handle("createSession", createSession)
      .handle("moveSession", moveSession)
      .handle("removeSession", removeSession)
      .handle("removeProject", removeProject)
  }),
)
