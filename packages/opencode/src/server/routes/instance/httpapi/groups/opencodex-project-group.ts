import { OpencodeXCapabilities } from "@/opencodex/capabilities"
import { OpencodeXProject } from "@/opencodex/project"
import { OpencodeXSessionState } from "@/opencodex/session-state"
import { OpencodeXSessionCard } from "@/opencodex/session-card"
import { OpencodeXSettings } from "@/opencodex/settings"
import { OpencodeXState } from "@/opencodex/state"
import { SessionID } from "@/session/schema"
import { Session } from "@/session/session"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiError, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { ApiNotFoundError, ConflictError, ProjectNotFoundError } from "../errors"
import { described } from "./metadata"
import {
  OPENCODEX_ROOT,
  SessionSyncQuery,
  StateEventQuery,
  StateQuery,
  StateSessionCardQuery,
  StateSessionQuery,
  UpdateProjectPayload,
  UpdateSessionStatePayload,
} from "./opencodex-schema"

export const opencodexProjectGroup = HttpApiGroup.make("opencodex").add(
  HttpApiEndpoint.get("getSettings", `${OPENCODEX_ROOT}/settings`, {
    success: described(OpencodeXSettings.Info, "OpenCodeX-only settings"),
    error: HttpApiError.BadRequest,
  }).annotateMerge(
    OpenApi.annotations({ identifier: "opencodex.settings.get", summary: "Get OpenCodeX-only settings" }),
  ),
  HttpApiEndpoint.patch("updateSettings", `${OPENCODEX_ROOT}/settings`, {
    payload: OpencodeXSettings.UpdateInput,
    success: described(OpencodeXSettings.Info, "Updated OpenCodeX-only settings"),
    error: [HttpApiError.BadRequest, ConflictError],
  }).annotateMerge(
    OpenApi.annotations({ identifier: "opencodex.settings.update", summary: "Update OpenCodeX-only settings" }),
  ),
  HttpApiEndpoint.get("listProjects", `${OPENCODEX_ROOT}/project`, {
    success: described(Schema.Array(OpencodeXProject.Info), "List of OpencodeX projects"),
    error: [HttpApiError.BadRequest, ApiNotFoundError],
  }).annotateMerge(OpenApi.annotations({ identifier: "opencodex.project.list", summary: "List OpencodeX projects" })),
  HttpApiEndpoint.post("createProject", `${OPENCODEX_ROOT}/project`, {
    payload: OpencodeXProject.CreateInput,
    success: described(OpencodeXProject.Info, "Created OpencodeX project"),
    error: [HttpApiError.BadRequest, ProjectNotFoundError],
  }).annotateMerge(
    OpenApi.annotations({ identifier: "opencodex.project.create", summary: "Create OpencodeX project" }),
  ),
  HttpApiEndpoint.post("validateProject", `${OPENCODEX_ROOT}/project/validate`, {
    payload: OpencodeXProject.ValidateInput,
    success: described(OpencodeXProject.Validation, "Validated OpencodeX project folders"),
    error: HttpApiError.BadRequest,
  }).annotateMerge(
    OpenApi.annotations({ identifier: "opencodex.project.validate", summary: "Validate OpencodeX project folders" }),
  ),
  HttpApiEndpoint.patch("updateProject", `${OPENCODEX_ROOT}/project/:projectID`, {
    params: { projectID: Schema.String },
    payload: UpdateProjectPayload,
    success: described(OpencodeXProject.Info, "Updated OpencodeX project"),
    error: [HttpApiError.BadRequest, ProjectNotFoundError],
  }).annotateMerge(
    OpenApi.annotations({ identifier: "opencodex.project.update", summary: "Update OpencodeX project" }),
  ),
  HttpApiEndpoint.post("reorderProjects", `${OPENCODEX_ROOT}/project/reorder`, {
    payload: OpencodeXProject.ReorderInput,
    success: described(Schema.Array(OpencodeXProject.Info), "Reordered OpencodeX projects"),
    error: HttpApiError.BadRequest,
  }).annotateMerge(
    OpenApi.annotations({ identifier: "opencodex.project.reorder", summary: "Reorder OpencodeX projects" }),
  ),
  HttpApiEndpoint.post("createSession", `${OPENCODEX_ROOT}/session`, {
    payload: OpencodeXProject.CreateSessionInput,
    success: described(Session.Info, "Created session"),
    error: [HttpApiError.BadRequest, ProjectNotFoundError, ApiNotFoundError],
  }).annotateMerge(
    OpenApi.annotations({
      identifier: "opencodex.session.create",
      summary: "Create a session under an OpencodeX project",
    }),
  ),
  HttpApiEndpoint.get("stateSnapshot", `${OPENCODEX_ROOT}/state`, {
    query: StateQuery,
    success: described(OpencodeXState.OpencodeXStateSnapshot, "Server-authoritative OpencodeX state snapshot"),
    error: HttpApiError.BadRequest,
  }).annotateMerge(
    OpenApi.annotations({ identifier: "opencodex.state.snapshot", summary: "Get an atomic OpencodeX state snapshot" }),
  ),
  HttpApiEndpoint.get("stateOperations", `${OPENCODEX_ROOT}/state/operations`, {
    query: StateQuery,
    success: described(OpencodeXState.OpencodeXOperationsSnapshot, "Atomic OpencodeX operations snapshot"),
    error: HttpApiError.BadRequest,
  }).annotateMerge(
    OpenApi.annotations({
      identifier: "opencodex.state.operations",
      summary: "Get an atomic OpencodeX jobs and swarms snapshot",
    }),
  ),
  HttpApiEndpoint.get("stateCapabilities", `${OPENCODEX_ROOT}/state/capabilities`, {
    query: StateQuery,
    success: described(OpencodeXCapabilities.Snapshot, "Atomic OpencodeX capabilities snapshot"),
    error: HttpApiError.BadRequest,
  }).annotateMerge(
    OpenApi.annotations({
      identifier: "opencodex.state.capabilities",
      summary: "Get an atomic OpencodeX capabilities snapshot",
    }),
  ),
  HttpApiEndpoint.get("stateSessionCards", `${OPENCODEX_ROOT}/state/session-card`, {
    query: StateSessionCardQuery,
    success: described(OpencodeXSessionCard.Page, "Bounded page of canonical OpencodeX session cards"),
    error: HttpApiError.BadRequest,
  }).annotateMerge(
    OpenApi.annotations({
      identifier: "opencodex.state.session_cards",
      summary: "Get a session-card page or resolve retained session IDs",
    }),
  ),
  HttpApiEndpoint.get("stateSession", `${OPENCODEX_ROOT}/state/session/:sessionID`, {
    params: { sessionID: SessionID },
    query: StateSessionQuery,
    success: described(OpencodeXState.OpencodeXSessionSnapshot, "Atomic OpencodeX session snapshot"),
    error: [HttpApiError.BadRequest, ApiNotFoundError],
  }).annotateMerge(
    OpenApi.annotations({ identifier: "opencodex.state.session", summary: "Get an atomic OpencodeX session snapshot" }),
  ),
  HttpApiEndpoint.get("stateEvent", `${OPENCODEX_ROOT}/state/event`, {
    query: StateEventQuery,
    success: Schema.String.pipe(HttpApiSchema.asText({ contentType: "text/event-stream" })),
  }).annotateMerge(
    OpenApi.annotations({
      identifier: "opencodex.state.event",
      summary: "Subscribe to server-authoritative OpencodeX state events",
    }),
  ),
  HttpApiEndpoint.patch("updateSessionState", `${OPENCODEX_ROOT}/session-state/:sessionID`, {
    params: { sessionID: SessionID },
    payload: UpdateSessionStatePayload,
    success: described(OpencodeXSessionState.Info, "Updated OpencodeX session UI state"),
    error: [HttpApiError.BadRequest, ApiNotFoundError, ConflictError],
  }).annotateMerge(
    OpenApi.annotations({ identifier: "opencodex.session_state.update", summary: "Update OpencodeX session UI state" }),
  ),
  HttpApiEndpoint.post("moveSession", `${OPENCODEX_ROOT}/session/move`, {
    payload: OpencodeXProject.MoveSessionInput,
    success: described(Session.Info, "Moved session"),
    error: [HttpApiError.BadRequest, ProjectNotFoundError, ApiNotFoundError],
  }).annotateMerge(
    OpenApi.annotations({ identifier: "opencodex.session.move", summary: "Move a session into an OpencodeX project" }),
  ),
  HttpApiEndpoint.delete("removeSession", `${OPENCODEX_ROOT}/session/:sessionID`, {
    params: { sessionID: SessionID },
    success: described(Schema.Boolean, "Deleted session"),
    error: [HttpApiError.BadRequest, ApiNotFoundError],
  }).annotateMerge(OpenApi.annotations({ identifier: "opencodex.session.delete", summary: "Delete a session" })),
  HttpApiEndpoint.delete("removeProject", `${OPENCODEX_ROOT}/project/:projectID`, {
    params: { projectID: Schema.String },
    success: described(Schema.Boolean, "Deleted OpencodeX project"),
    error: HttpApiError.BadRequest,
  }).annotateMerge(
    OpenApi.annotations({ identifier: "opencodex.project.delete", summary: "Delete an OpencodeX project" }),
  ),
)
