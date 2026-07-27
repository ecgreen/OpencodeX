import type { GlobalEvent } from "@opencode-ai/sdk/v2/client"
import type { SessionWorkspaceRequest } from "./session-workspace-bridge"

export const GUI_BRIDGE_MAX_SCOPES = 512
export const GUI_BRIDGE_CAPABILITIES = [
  "workspace.open",
  "browser.navigate",
  "browser.state",
  "browser.screenshot",
  "browser.snapshot",
] as const
export type GuiBridgeCapability = typeof GUI_BRIDGE_CAPABILITIES[number]

export type GuiBridgeDesiredState = {
  clientID: string
  token: string
  capabilities: GuiBridgeCapability[]
  scopes: Array<{ directory: string; workspaceID?: string }>
}

export type GuiBridgeRequest = SessionWorkspaceRequest & {
  clientID: string
  directory: string
  workspace?: string
  requestID: string
  sessionID: string
}

export function guiBridgeScopes(
  directory: string,
  sessions: Array<{ directory: string; workspaceID?: string }>,
  prioritySessions: Array<{ directory: string; workspaceID?: string }> = [],
) {
  const scopes = new Map<string, { directory: string; workspaceID?: string }>()
  const retain = (scope: { directory: string; workspaceID?: string }) => {
    if (!scope.directory || scopes.size >= GUI_BRIDGE_MAX_SCOPES) return
    const key = guiBridgeScopeKey(scope)
    if (!scopes.has(key)) scopes.set(key, scope)
  }
  retain({ directory })
  prioritySessions.forEach(retain)
  sessions.forEach(retain)
  return Array.from(scopes.values()).toSorted((left, right) =>
    guiBridgeScopeKey(left).localeCompare(guiBridgeScopeKey(right)),
  )
}

export function guiBridgeDesiredState(input: {
  clientID: string
  token: string
  capabilities: ReadonlyArray<GuiBridgeCapability>
  directory: string
  sessions: Array<{ directory: string; workspaceID?: string }>
  prioritySessions?: Array<{ directory: string; workspaceID?: string }>
}): GuiBridgeDesiredState {
  return {
    clientID: input.clientID,
    token: input.token,
    capabilities: Array.from(new Set(input.capabilities)),
    scopes: guiBridgeScopes(input.directory, input.sessions, input.prioritySessions),
  }
}

export function guiBridgeRequestMatchesSession(
  request: Pick<GuiBridgeRequest, "directory" | "workspace">,
  session: { directory: string; workspaceID?: string },
) {
  return request.directory === session.directory && request.workspace === session.workspaceID
}

export function createGuiBridgeLease(input: {
  sync: (desired: GuiBridgeDesiredState) => Promise<{ generation: string }>
  unregister: (lease: { clientID: string; token: string; generation: string }) => Promise<void>
  onError: (operation: "sync" | "unregister", cause: unknown) => void
}) {
  let desired: GuiBridgeDesiredState | undefined
  let generation: string | undefined
  let signature = ""
  let closed = false
  let tail = Promise.resolve()

  const runSync = (next: GuiBridgeDesiredState, nextSignature: string) => {
    tail = tail.then(async () => {
      if (closed) return
      try {
        generation = (await input.sync(next)).generation
      } catch (cause) {
        if (signature === nextSignature) signature = ""
        input.onError("sync", cause)
      }
    })
    return tail
  }

  const update = (next: GuiBridgeDesiredState) => {
    if (closed) return tail
    desired = next
    const nextSignature = JSON.stringify(next)
    if (signature === nextSignature) return tail
    signature = nextSignature
    return runSync(next, nextSignature)
  }

  const renew = () => {
    if (closed || !desired) return tail
    return runSync(desired, signature)
  }

  const dispose = () => {
    if (closed) return tail
    closed = true
    tail = tail.then(async () => {
      if (!desired || !generation) return
      try {
        await input.unregister({ clientID: desired.clientID, token: desired.token, generation })
      } catch (cause) {
        input.onError("unregister", cause)
      }
    })
    return tail
  }

  return { update, renew, dispose }
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

function guiBridgeScopeKey(scope: { directory: string; workspaceID?: string }) {
  return JSON.stringify([scope.directory, scope.workspaceID ?? null])
}
