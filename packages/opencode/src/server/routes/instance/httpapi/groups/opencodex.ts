import { OpencodeXProject } from "@/opencodex/project"
import { Session } from "@/session/session"
import { SessionID } from "@/session/schema"
import { Schema, Struct } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { described } from "./metadata"
import { ApiNotFoundError, ProjectNotFoundError } from "../errors"

const root = "/experimental/opencodex"

export const UpdateProjectPayload = Schema.Struct(Struct.omit(OpencodeXProject.UpdateInput.fields, ["projectID"]))

export const OpencodeXApi = HttpApi.make("opencodex")
  .add(
    HttpApiGroup.make("opencodex")
      .add(
        HttpApiEndpoint.get("listProjects", `${root}/project`, {
          success: described(Schema.Array(OpencodeXProject.Info), "List of OpencodeX projects"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.project.list",
            summary: "List OpencodeX projects",
          }),
        ),
        HttpApiEndpoint.post("createProject", `${root}/project`, {
          payload: OpencodeXProject.CreateInput,
          success: described(OpencodeXProject.Info, "Created OpencodeX project"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.project.create",
            summary: "Create OpencodeX project",
          }),
        ),
        HttpApiEndpoint.post("validateProject", `${root}/project/validate`, {
          payload: OpencodeXProject.ValidateInput,
          success: described(OpencodeXProject.Validation, "Validated OpencodeX project folders"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.project.validate",
            summary: "Validate OpencodeX project folders",
          }),
        ),
        HttpApiEndpoint.patch("updateProject", `${root}/project/:projectID`, {
          params: { projectID: Schema.String },
          payload: UpdateProjectPayload,
          success: described(OpencodeXProject.Info, "Updated OpencodeX project"),
          error: [HttpApiError.BadRequest, ProjectNotFoundError, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.project.update",
            summary: "Update OpencodeX project",
          }),
        ),
        HttpApiEndpoint.post("createSession", `${root}/session`, {
          payload: OpencodeXProject.CreateSessionInput,
          success: described(Session.Info, "Created session"),
          error: [HttpApiError.BadRequest, ProjectNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.session.create",
            summary: "Create a session under an OpencodeX project",
          }),
        ),
        HttpApiEndpoint.post("moveSession", `${root}/session/move`, {
          payload: OpencodeXProject.MoveSessionInput,
          success: described(Session.Info, "Moved session"),
          error: [HttpApiError.BadRequest, ProjectNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.session.move",
            summary: "Move a session into an OpencodeX project",
          }),
        ),
        HttpApiEndpoint.delete("removeSession", `${root}/session/:sessionID`, {
          params: { sessionID: SessionID },
          success: described(Schema.Boolean, "Deleted session"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.session.delete",
            summary: "Delete a session",
          }),
        ),
        HttpApiEndpoint.delete("removeProject", `${root}/project/:projectID`, {
          params: { projectID: Schema.String },
          success: described(Schema.Boolean, "Deleted OpencodeX project"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.project.delete",
            summary: "Delete an OpencodeX project",
          }),
        ),
      )
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "opencodex",
      version: "0.0.1",
      description: "OpencodeX project and session overlay routes.",
    }),
  )
