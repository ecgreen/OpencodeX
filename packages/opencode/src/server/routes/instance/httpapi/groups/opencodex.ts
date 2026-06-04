import { OpencodeXProject } from "@/opencodex/project"
import { OpencodeXJob } from "@/opencodex/job"
import { OpencodeXSwarm } from "@/opencodex/swarm"
import { OpencodeXView } from "@/opencodex/view"
import { Session } from "@/session/session"
import { SessionID } from "@/session/schema"
import { Schema, Struct } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware } from "../middleware/workspace-routing"
import { described } from "./metadata"
import { ApiNotFoundError, ProjectNotFoundError } from "../errors"

const root = "/experimental/opencodex"

export const UpdateProjectPayload = Schema.Struct(Struct.omit(OpencodeXProject.UpdateInput.fields, ["projectID"]))
export const UpdateJobPayload = Schema.Struct(Struct.omit(OpencodeXJob.UpdateInput.fields, ["id"]))
export const UpdateViewPayload = Schema.Struct(Struct.omit(OpencodeXView.UpdateInput.fields, ["id"]))

export const OpencodeXApi = HttpApi.make("opencodex")
  .add(
    HttpApiGroup.make("opencodex")
      .add(
        HttpApiEndpoint.get("listProjects", `${root}/project`, {
          success: described(Schema.Array(OpencodeXProject.Info), "List of OpencodeX projects"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.project.list",
            summary: "List OpencodeX projects",
          }),
        ),
        HttpApiEndpoint.post("createProject", `${root}/project`, {
          payload: OpencodeXProject.CreateInput,
          success: described(OpencodeXProject.Info, "Created OpencodeX project"),
          error: [HttpApiError.BadRequest, ProjectNotFoundError],
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
          error: [HttpApiError.BadRequest, ProjectNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.project.update",
            summary: "Update OpencodeX project",
          }),
        ),
        HttpApiEndpoint.post("reorderProjects", `${root}/project/reorder`, {
          payload: OpencodeXProject.ReorderInput,
          success: described(Schema.Array(OpencodeXProject.Info), "Reordered OpencodeX projects"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.project.reorder",
            summary: "Reorder OpencodeX projects",
          }),
        ),
        HttpApiEndpoint.post("createSession", `${root}/session`, {
          payload: OpencodeXProject.CreateSessionInput,
          success: described(Session.Info, "Created session"),
          error: [HttpApiError.BadRequest, ProjectNotFoundError, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.session.create",
            summary: "Create a session under an OpencodeX project",
          }),
        ),
        HttpApiEndpoint.post("moveSession", `${root}/session/move`, {
          payload: OpencodeXProject.MoveSessionInput,
          success: described(Session.Info, "Moved session"),
          error: [HttpApiError.BadRequest, ProjectNotFoundError, ApiNotFoundError],
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
        HttpApiEndpoint.get("listJobs", `${root}/job`, {
          success: described(Schema.Array(OpencodeXJob.Info), "List OpencodeX jobs"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.job.list",
            summary: "List OpencodeX jobs",
          }),
        ),
        HttpApiEndpoint.post("createJob", `${root}/job`, {
          payload: OpencodeXJob.CreateInput,
          success: described(OpencodeXJob.Info, "Created OpencodeX job"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.job.create",
            summary: "Create OpencodeX job",
          }),
        ),
        HttpApiEndpoint.get("getJob", `${root}/job/:jobID`, {
          params: { jobID: Schema.String },
          success: described(OpencodeXJob.Info, "OpencodeX job"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.job.get",
            summary: "Get OpencodeX job",
          }),
        ),
        HttpApiEndpoint.patch("updateJob", `${root}/job/:jobID`, {
          params: { jobID: Schema.String },
          payload: UpdateJobPayload,
          success: described(OpencodeXJob.Info, "Updated OpencodeX job"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.job.update",
            summary: "Update OpencodeX job",
          }),
        ),
        HttpApiEndpoint.post("cancelJob", `${root}/job/:jobID/cancel`, {
          params: { jobID: Schema.String },
          success: described(OpencodeXJob.Info, "Cancelled OpencodeX job"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.job.cancel",
            summary: "Cancel OpencodeX job",
          }),
        ),
        HttpApiEndpoint.get("listSwarms", `${root}/swarm`, {
          success: described(Schema.Array(OpencodeXSwarm.Info), "List OpencodeX swarms"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.swarm.list",
            summary: "List OpencodeX swarms",
          }),
        ),
        HttpApiEndpoint.post("createSwarm", `${root}/swarm`, {
          payload: OpencodeXSwarm.CreateInput,
          success: described(OpencodeXSwarm.Info, "Created OpencodeX swarm"),
          error: [HttpApiError.BadRequest, ProjectNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.swarm.create",
            summary: "Create OpencodeX swarm",
          }),
        ),
        HttpApiEndpoint.get("getSwarm", `${root}/swarm/:swarmID`, {
          params: { swarmID: Schema.String },
          success: described(OpencodeXSwarm.Info, "OpencodeX swarm"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.swarm.get",
            summary: "Get OpencodeX swarm",
          }),
        ),
        HttpApiEndpoint.patch("updateSwarm", `${root}/swarm/:swarmID`, {
          params: { swarmID: Schema.String },
          payload: OpencodeXSwarm.UpdateInput,
          success: described(OpencodeXSwarm.Info, "Updated OpencodeX swarm"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.swarm.update",
            summary: "Update OpencodeX swarm",
          }),
        ),
        HttpApiEndpoint.post("startSwarm", `${root}/swarm/:swarmID/start`, {
          params: { swarmID: Schema.String },
          success: described(OpencodeXSwarm.Info, "Started OpencodeX swarm"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.swarm.start",
            summary: "Start OpencodeX swarm",
          }),
        ),
        HttpApiEndpoint.post("assignSwarmTask", `${root}/swarm/:swarmID/task`, {
          params: { swarmID: Schema.String },
          payload: OpencodeXSwarm.AssignTaskInput,
          success: described(OpencodeXSwarm.Info, "Assigned task to OpencodeX swarm"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.swarm.task.assign",
            summary: "Assign task to OpencodeX swarm",
          }),
        ),
        HttpApiEndpoint.post("cancelSwarm", `${root}/swarm/:swarmID/cancel`, {
          params: { swarmID: Schema.String },
          success: described(OpencodeXSwarm.Info, "Cancelled OpencodeX swarm"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.swarm.cancel",
            summary: "Cancel OpencodeX swarm",
          }),
        ),
        HttpApiEndpoint.delete("removeSwarm", `${root}/swarm/:swarmID`, {
          params: { swarmID: Schema.String },
          success: described(Schema.Boolean, "Deleted OpencodeX swarm"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.swarm.delete",
            summary: "Delete OpencodeX swarm",
          }),
        ),
        HttpApiEndpoint.post("addSwarmRole", `${root}/swarm/:swarmID/role`, {
          params: { swarmID: Schema.String },
          payload: OpencodeXSwarm.AddRoleInput,
          success: described(OpencodeXSwarm.Info, "Updated OpencodeX swarm"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.swarm.role.add",
            summary: "Add OpencodeX swarm role",
          }),
        ),
        HttpApiEndpoint.patch("updateSwarmRole", `${root}/swarm/:swarmID/role/:roleID`, {
          params: { swarmID: Schema.String, roleID: Schema.String },
          payload: OpencodeXSwarm.UpdateRoleInput,
          success: described(OpencodeXSwarm.Info, "Updated OpencodeX swarm"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.swarm.role.update",
            summary: "Update OpencodeX swarm role",
          }),
        ),
        HttpApiEndpoint.get("listViews", `${root}/view`, {
          success: described(Schema.Array(OpencodeXView.Info), "List OpencodeX views"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.view.list",
            summary: "List OpencodeX views",
          }),
        ),
        HttpApiEndpoint.post("createView", `${root}/view`, {
          payload: OpencodeXView.CreateInput,
          success: described(OpencodeXView.Info, "Created OpencodeX view"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.view.create",
            summary: "Create OpencodeX view",
          }),
        ),
        HttpApiEndpoint.post("reorderViews", `${root}/view/reorder`, {
          payload: OpencodeXView.ReorderInput,
          success: described(Schema.Array(OpencodeXView.Info), "Reordered OpencodeX views"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.view.reorder",
            summary: "Reorder OpencodeX views",
          }),
        ),
        HttpApiEndpoint.get("getView", `${root}/view/:viewID`, {
          params: { viewID: Schema.String },
          success: described(OpencodeXView.Info, "OpencodeX view"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.view.get",
            summary: "Get OpencodeX view",
          }),
        ),
        HttpApiEndpoint.patch("updateView", `${root}/view/:viewID`, {
          params: { viewID: Schema.String },
          payload: UpdateViewPayload,
          success: described(OpencodeXView.Info, "Updated OpencodeX view"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.view.update",
            summary: "Update OpencodeX view",
          }),
        ),
        HttpApiEndpoint.delete("removeView", `${root}/view/:viewID`, {
          params: { viewID: Schema.String },
          success: described(Schema.Boolean, "Deleted OpencodeX view"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.view.delete",
            summary: "Delete OpencodeX view",
          }),
        ),
      )
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "opencodex",
      version: "0.0.1",
      description: "OpencodeX project and session overlay routes.",
    }),
  )
