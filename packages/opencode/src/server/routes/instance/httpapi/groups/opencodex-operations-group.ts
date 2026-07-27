import { OpencodeXJob } from "@/opencodex/job"
import { OpencodeXSwarm } from "@/opencodex/swarm"
import { OpencodeXTerminalSession } from "@/opencodex/terminal-session"
import { OpencodeXView } from "@/opencodex/view"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiError, OpenApi } from "effect/unstable/httpapi"
import { ApiNotFoundError, ConflictError, ProjectNotFoundError } from "../errors"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware } from "../middleware/workspace-routing"
import { described } from "./metadata"
import {
  ClaimJobPayload,
  CompleteJobPayload,
  FailJobPayload,
  OPENCODEX_ROOT,
  StartJobPayload,
  UpdateJobPayload,
  UpdateTerminalSessionPayload,
  UpdateViewPayload,
} from "./opencodex-schema"
import { opencodexWorkbenchGroup } from "./opencodex-workbench-group"

export const opencodexGroup = opencodexWorkbenchGroup
  .add(
    HttpApiEndpoint.post("createJob", `${OPENCODEX_ROOT}/job`, {
      payload: OpencodeXJob.CreateInput,
      success: described(OpencodeXJob.Info, "Created OpencodeX job"),
      error: HttpApiError.BadRequest,
    }).annotateMerge(OpenApi.annotations({ identifier: "opencodex.job.create", summary: "Create OpencodeX job" })),
    HttpApiEndpoint.get("getJob", `${OPENCODEX_ROOT}/job/:jobID`, {
      params: { jobID: Schema.String },
      success: described(OpencodeXJob.Info, "OpencodeX job"),
      error: [HttpApiError.BadRequest, ApiNotFoundError],
    }).annotateMerge(OpenApi.annotations({ identifier: "opencodex.job.get", summary: "Get OpencodeX job" })),
    HttpApiEndpoint.patch("updateJob", `${OPENCODEX_ROOT}/job/:jobID`, {
      params: { jobID: Schema.String },
      payload: UpdateJobPayload,
      success: described(OpencodeXJob.Info, "Updated OpencodeX job"),
      error: [HttpApiError.BadRequest, ApiNotFoundError],
    }).annotateMerge(OpenApi.annotations({ identifier: "opencodex.job.update", summary: "Update OpencodeX job" })),
    HttpApiEndpoint.post("cancelJob", `${OPENCODEX_ROOT}/job/:jobID/cancel`, {
      params: { jobID: Schema.String },
      success: described(OpencodeXJob.Info, "Cancelled OpencodeX job"),
      error: [HttpApiError.BadRequest, ApiNotFoundError],
    }).annotateMerge(OpenApi.annotations({ identifier: "opencodex.job.cancel", summary: "Cancel OpencodeX job" })),
    HttpApiEndpoint.post("claimJob", `${OPENCODEX_ROOT}/job/:jobID/claim`, {
      params: { jobID: Schema.String },
      payload: ClaimJobPayload,
      success: described(OpencodeXJob.Info, "Claimed OpencodeX job"),
      error: [HttpApiError.BadRequest, ApiNotFoundError],
    }).annotateMerge(OpenApi.annotations({ identifier: "opencodex.job.claim", summary: "Claim an OpencodeX job lease" })),
    HttpApiEndpoint.post("startJob", `${OPENCODEX_ROOT}/job/:jobID/start`, {
      params: { jobID: Schema.String },
      payload: StartJobPayload,
      success: described(OpencodeXJob.Info, "Running OpencodeX job"),
      error: [HttpApiError.BadRequest, ApiNotFoundError],
    }).annotateMerge(OpenApi.annotations({ identifier: "opencodex.job.start", summary: "Start a claimed OpencodeX job" })),
    HttpApiEndpoint.post("renewJob", `${OPENCODEX_ROOT}/job/:jobID/renew`, {
      params: { jobID: Schema.String },
      payload: ClaimJobPayload,
      success: described(OpencodeXJob.Info, "Renewed OpencodeX job lease"),
      error: [HttpApiError.BadRequest, ApiNotFoundError],
    }).annotateMerge(OpenApi.annotations({ identifier: "opencodex.job.renew", summary: "Renew an OpencodeX job lease" })),
    HttpApiEndpoint.post("succeedJob", `${OPENCODEX_ROOT}/job/:jobID/succeed`, {
      params: { jobID: Schema.String },
      payload: CompleteJobPayload,
      success: described(OpencodeXJob.Info, "Succeeded OpencodeX job"),
      error: [HttpApiError.BadRequest, ApiNotFoundError],
    }).annotateMerge(
      OpenApi.annotations({ identifier: "opencodex.job.succeed", summary: "Complete an OpencodeX job successfully" }),
    ),
    HttpApiEndpoint.post("failJob", `${OPENCODEX_ROOT}/job/:jobID/fail`, {
      params: { jobID: Schema.String },
      payload: FailJobPayload,
      success: described(OpencodeXJob.Info, "Failed OpencodeX job"),
      error: [HttpApiError.BadRequest, ApiNotFoundError],
    }).annotateMerge(
      OpenApi.annotations({ identifier: "opencodex.job.fail", summary: "Complete an OpencodeX job with a typed failure" }),
    ),
    HttpApiEndpoint.post("retryJob", `${OPENCODEX_ROOT}/job/:jobID/retry`, {
      params: { jobID: Schema.String },
      success: described(OpencodeXJob.Info, "Requeued OpencodeX job"),
      error: [HttpApiError.BadRequest, ApiNotFoundError],
    }).annotateMerge(
      OpenApi.annotations({ identifier: "opencodex.job.retry", summary: "Requeue an interrupted or failed OpencodeX job" }),
    ),
    HttpApiEndpoint.get("listSwarms", `${OPENCODEX_ROOT}/swarm`, {
      success: described(Schema.Array(OpencodeXSwarm.Info), "List OpencodeX swarms"),
      error: HttpApiError.BadRequest,
    }).annotateMerge(OpenApi.annotations({ identifier: "opencodex.swarm.list", summary: "List OpencodeX swarms" })),
    HttpApiEndpoint.post("createSwarm", `${OPENCODEX_ROOT}/swarm`, {
      payload: OpencodeXSwarm.CreateInput,
      success: described(OpencodeXSwarm.Info, "Created OpencodeX swarm"),
      error: [HttpApiError.BadRequest, ProjectNotFoundError],
    }).annotateMerge(OpenApi.annotations({ identifier: "opencodex.swarm.create", summary: "Create OpencodeX swarm" })),
    HttpApiEndpoint.get("getSwarm", `${OPENCODEX_ROOT}/swarm/:swarmID`, {
      params: { swarmID: Schema.String },
      success: described(OpencodeXSwarm.Info, "OpencodeX swarm"),
      error: [HttpApiError.BadRequest, ApiNotFoundError],
    }).annotateMerge(OpenApi.annotations({ identifier: "opencodex.swarm.get", summary: "Get OpencodeX swarm" })),
    HttpApiEndpoint.patch("updateSwarm", `${OPENCODEX_ROOT}/swarm/:swarmID`, {
      params: { swarmID: Schema.String },
      payload: OpencodeXSwarm.UpdateInput,
      success: described(OpencodeXSwarm.Info, "Updated OpencodeX swarm"),
      error: [HttpApiError.BadRequest, ApiNotFoundError],
    }).annotateMerge(OpenApi.annotations({ identifier: "opencodex.swarm.update", summary: "Update OpencodeX swarm" })),
    HttpApiEndpoint.post("startSwarm", `${OPENCODEX_ROOT}/swarm/:swarmID/start`, {
      params: { swarmID: Schema.String },
      success: described(OpencodeXSwarm.Info, "Started OpencodeX swarm"),
      error: [HttpApiError.BadRequest, ApiNotFoundError],
    }).annotateMerge(OpenApi.annotations({ identifier: "opencodex.swarm.start", summary: "Start OpencodeX swarm" })),
    HttpApiEndpoint.post("assignSwarmTask", `${OPENCODEX_ROOT}/swarm/:swarmID/task`, {
      params: { swarmID: Schema.String },
      payload: OpencodeXSwarm.AssignTaskInput,
      success: described(OpencodeXSwarm.Info, "Assigned task to OpencodeX swarm"),
      error: [HttpApiError.BadRequest, ApiNotFoundError],
    }).annotateMerge(OpenApi.annotations({ identifier: "opencodex.swarm.task.assign", summary: "Assign task to OpencodeX swarm" })),
    HttpApiEndpoint.post("cancelSwarm", `${OPENCODEX_ROOT}/swarm/:swarmID/cancel`, {
      params: { swarmID: Schema.String },
      success: described(OpencodeXSwarm.Info, "Cancelled OpencodeX swarm"),
      error: [HttpApiError.BadRequest, ApiNotFoundError],
    }).annotateMerge(OpenApi.annotations({ identifier: "opencodex.swarm.cancel", summary: "Cancel OpencodeX swarm" })),
    HttpApiEndpoint.delete("removeSwarm", `${OPENCODEX_ROOT}/swarm/:swarmID`, {
      params: { swarmID: Schema.String },
      success: described(Schema.Boolean, "Deleted OpencodeX swarm"),
      error: [HttpApiError.BadRequest, ApiNotFoundError],
    }).annotateMerge(OpenApi.annotations({ identifier: "opencodex.swarm.delete", summary: "Delete OpencodeX swarm" })),
    HttpApiEndpoint.post("addSwarmRole", `${OPENCODEX_ROOT}/swarm/:swarmID/role`, {
      params: { swarmID: Schema.String },
      payload: OpencodeXSwarm.AddRoleInput,
      success: described(OpencodeXSwarm.Info, "Updated OpencodeX swarm"),
      error: [HttpApiError.BadRequest, ApiNotFoundError],
    }).annotateMerge(OpenApi.annotations({ identifier: "opencodex.swarm.role.add", summary: "Add OpencodeX swarm role" })),
    HttpApiEndpoint.patch("updateSwarmRole", `${OPENCODEX_ROOT}/swarm/:swarmID/role/:roleID`, {
      params: { swarmID: Schema.String, roleID: Schema.String },
      payload: OpencodeXSwarm.UpdateRoleInput,
      success: described(OpencodeXSwarm.Info, "Updated OpencodeX swarm"),
      error: [HttpApiError.BadRequest, ApiNotFoundError],
    }).annotateMerge(OpenApi.annotations({ identifier: "opencodex.swarm.role.update", summary: "Update OpencodeX swarm role" })),
    HttpApiEndpoint.get("listTerminalSessions", `${OPENCODEX_ROOT}/terminal-session`, {
      success: described(Schema.Array(OpencodeXTerminalSession.Info), "List OpencodeX terminal sessions"),
      error: HttpApiError.BadRequest,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "opencodex.terminal_session.list",
        summary: "List OpencodeX terminal sessions",
      }),
    ),
    HttpApiEndpoint.post("createTerminalSession", `${OPENCODEX_ROOT}/terminal-session`, {
      payload: OpencodeXTerminalSession.CreateInput,
      success: described(OpencodeXTerminalSession.Info, "Created OpencodeX terminal session"),
      error: HttpApiError.BadRequest,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "opencodex.terminal_session.create",
        summary: "Create an OpencodeX terminal session",
      }),
    ),
    HttpApiEndpoint.get("getTerminalSession", `${OPENCODEX_ROOT}/terminal-session/:terminalSessionID`, {
      params: { terminalSessionID: Schema.String },
      success: described(OpencodeXTerminalSession.Info, "OpencodeX terminal session"),
      error: [HttpApiError.BadRequest, ApiNotFoundError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "opencodex.terminal_session.get",
        summary: "Get an OpencodeX terminal session",
      }),
    ),
    HttpApiEndpoint.patch("updateTerminalSession", `${OPENCODEX_ROOT}/terminal-session/:terminalSessionID`, {
      params: { terminalSessionID: Schema.String },
      payload: UpdateTerminalSessionPayload,
      success: described(OpencodeXTerminalSession.Info, "Updated OpencodeX terminal session"),
      error: [HttpApiError.BadRequest, ApiNotFoundError, ConflictError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "opencodex.terminal_session.update",
        summary: "Update an OpencodeX terminal session",
      }),
    ),
    HttpApiEndpoint.post("openTerminalSession", `${OPENCODEX_ROOT}/terminal-session/:terminalSessionID/opened`, {
      params: { terminalSessionID: Schema.String },
      success: described(OpencodeXTerminalSession.Info, "Opened OpencodeX terminal session"),
      error: [HttpApiError.BadRequest, ApiNotFoundError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "opencodex.terminal_session.opened",
        summary: "Record an OpencodeX terminal session launch",
      }),
    ),
    HttpApiEndpoint.delete("removeTerminalSession", `${OPENCODEX_ROOT}/terminal-session/:terminalSessionID`, {
      params: { terminalSessionID: Schema.String },
      success: described(Schema.Boolean, "Deleted OpencodeX terminal session"),
      error: [HttpApiError.BadRequest, ApiNotFoundError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "opencodex.terminal_session.delete",
        summary: "Delete an OpencodeX terminal session",
      }),
    ),
    HttpApiEndpoint.get("listViews", `${OPENCODEX_ROOT}/view`, {
      success: described(Schema.Array(OpencodeXView.Info), "List OpencodeX views"),
      error: HttpApiError.BadRequest,
    }).annotateMerge(OpenApi.annotations({ identifier: "opencodex.view.list", summary: "List OpencodeX views" })),
    HttpApiEndpoint.post("createView", `${OPENCODEX_ROOT}/view`, {
      payload: OpencodeXView.CreateInput,
      success: described(OpencodeXView.Info, "Created OpencodeX view"),
      error: HttpApiError.BadRequest,
    }).annotateMerge(OpenApi.annotations({ identifier: "opencodex.view.create", summary: "Create OpencodeX view" })),
    HttpApiEndpoint.post("reorderViews", `${OPENCODEX_ROOT}/view/reorder`, {
      payload: OpencodeXView.ReorderInput,
      success: described(Schema.Array(OpencodeXView.Info), "Reordered OpencodeX views"),
      error: HttpApiError.BadRequest,
    }).annotateMerge(OpenApi.annotations({ identifier: "opencodex.view.reorder", summary: "Reorder OpencodeX views" })),
    HttpApiEndpoint.get("getView", `${OPENCODEX_ROOT}/view/:viewID`, {
      params: { viewID: Schema.String },
      success: described(OpencodeXView.Info, "OpencodeX view"),
      error: [HttpApiError.BadRequest, ApiNotFoundError],
    }).annotateMerge(OpenApi.annotations({ identifier: "opencodex.view.get", summary: "Get OpencodeX view" })),
    HttpApiEndpoint.patch("updateView", `${OPENCODEX_ROOT}/view/:viewID`, {
      params: { viewID: Schema.String },
      payload: UpdateViewPayload,
      success: described(OpencodeXView.Info, "Updated OpencodeX view"),
      error: [HttpApiError.BadRequest, ApiNotFoundError, ConflictError],
    }).annotateMerge(OpenApi.annotations({ identifier: "opencodex.view.update", summary: "Update OpencodeX view" })),
    HttpApiEndpoint.delete("removeView", `${OPENCODEX_ROOT}/view/:viewID`, {
      params: { viewID: Schema.String },
      success: described(Schema.Boolean, "Deleted OpencodeX view"),
      error: [HttpApiError.BadRequest, ApiNotFoundError],
    }).annotateMerge(OpenApi.annotations({ identifier: "opencodex.view.delete", summary: "Delete OpencodeX view" })),
  )
  .middleware(InstanceContextMiddleware)
  .middleware(WorkspaceRoutingMiddleware)
  .middleware(Authorization)
