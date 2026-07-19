import type { GlobalEvent } from "@opencode-ai/sdk/v2/client"
import type { SessionWorkspaceRequest } from "./session-workspace-bridge"

export type GuiBridgeRequest = SessionWorkspaceRequest & {
  clientID: string
  directory: string
  workspace?: string
  requestID: string
  sessionID: string
}

export function guiBridgeScopes(directory: string, sessions: Array<{ directory: string; workspaceID?: string }>) {
  return Array.from(new Map([
    ...(directory ? [{ directory, workspace: undefined }] : []),
    ...sessions.map((session) => ({ directory: session.directory, workspace: session.workspaceID })),
  ].filter((scope) => scope.directory).map((scope) => [`${scope.directory}\n${scope.workspace ?? ""}`, scope])).values())
    .toSorted((left, right) => `${left.directory}\n${left.workspace ?? ""}`.localeCompare(`${right.directory}\n${right.workspace ?? ""}`))
}

export function guiBridgeRequestFromEvent(event: GlobalEvent, clientIDs: string | ReadonlySet<string>): GuiBridgeRequest | undefined {
  if (event.payload.type !== "opencodex.gui_bridge.request") return
  const request = event.payload.properties
  if (!(typeof clientIDs === "string" ? request.clientID === clientIDs : clientIDs.has(request.clientID)) || !request.requestID || !request.sessionID || !isRecord(request.input)) return
  const common = { clientID: request.clientID, directory: event.directory, workspace: event.workspace, requestID: request.requestID, sessionID: request.sessionID }
  const path = stringField(request.input, "path")
  if (request.operation === "workspace.open" && path !== undefined) {
    return { ...common, operation: request.operation, input: { path } }
  }
  const url = stringField(request.input, "url")
  if (request.operation === "browser.navigate" && url !== undefined) {
    return { ...common, operation: request.operation, input: { url } }
  }
  if (request.operation === "browser.state") {
    return { ...common, operation: request.operation, input: {} }
  }
  const expectedURL = stringField(request.input, "expectedURL")
  if ((request.operation === "browser.screenshot" || request.operation === "browser.snapshot") && expectedURL !== undefined) {
    return { ...common, operation: request.operation, input: { expectedURL } }
  }
}

export function guiBridgeErrorMessage(cause: unknown) {
  if (cause instanceof Error && cause.message.trim()) return cause.message.slice(0, 10_000)
  if (typeof cause === "string" && cause.trim()) return cause.slice(0, 10_000)
  return "The GUI could not complete the requested operation."
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stringField(value: unknown, key: string) {
  if (!isRecord(value)) return
  return typeof value[key] === "string" ? value[key] : undefined
}
