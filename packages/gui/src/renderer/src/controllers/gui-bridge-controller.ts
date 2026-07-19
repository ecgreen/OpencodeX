import { createEffect, createMemo, onCleanup } from "solid-js"
import { guiBridgeErrorMessage, guiBridgeRequestFromEvent, guiBridgeScopes, type GuiBridgeRequest } from "../lib/gui-bridge"
import { authHeaders } from "../lib/store"
import { openSessionWorkspace, requestSessionWorkspace, type SessionWorkspaceResult } from "../lib/session-workspace-bridge"
import type { createAuthoritativeStateController } from "./authoritative-state-controller"
import type { createNavigationController } from "./navigation-controller"
import type { createSessionSelectionController } from "./session-selection-controller"
import type { createViewController } from "./view-controller"
import type { GuiClient } from "../lib/client"

const CAPABILITIES = [
  "workspace.open",
  "browser.navigate",
  "browser.state",
  "browser.screenshot",
  "browser.snapshot",
] as const
type BridgeCapability = typeof CAPABILITIES[number]

export function createGuiBridgeController(input: {
  authoritative: ReturnType<typeof createAuthoritativeStateController>
  navigation: ReturnType<typeof createNavigationController>
  selection: ReturnType<typeof createSessionSelectionController>
  view: ReturnType<typeof createViewController>
}) {
  const baseClientID = `gui-${crypto.randomUUID()}`
  const token = randomToken()
  const clientIDByScope = new Map<string, string>()
  const activeClientIDs = new Set<string>()
  const tails = new Map<string, Promise<void>>()
  const scopeSignature = createMemo(() => JSON.stringify(guiBridgeScopes(input.authoritative.client()?.directory ?? "", input.authoritative.snapshot()?.sessions ?? [])))
  const unsubscribe = input.authoritative.subscribeGlobalEvents((event) => {
    const request = guiBridgeRequestFromEvent(event, activeClientIDs)
    if (!request) return
    const tail = (tails.get(request.sessionID) ?? Promise.resolve()).then(() => handle(request)).catch((cause) => {
      console.error("GUI bridge request failed", cause)
    })
    tails.set(request.sessionID, tail)
    void tail.finally(() => {
      if (tails.get(request.sessionID) === tail) tails.delete(request.sessionID)
    })
  })

  createEffect(() => {
    const gui = input.authoritative.client()
    if (!gui) return
    const scopes = JSON.parse(scopeSignature()) as ReturnType<typeof guiBridgeScopes>
    const capabilities: BridgeCapability[] = window.opencodex?.browser ? [...CAPABILITIES] : ["workspace.open"]
    const registrations = scopes.map((scope) => ({
      ...scope,
      clientID: clientIDForScope(scope, baseClientID, clientIDByScope),
    }))
    activeClientIDs.clear()
    registrations.forEach((registration) => activeClientIDs.add(registration.clientID))
    const register = () => Promise.all(registrations.map((registration) => gui.client.opencodex.guiBridge.register(
      { directory: registration.directory || undefined, workspace: registration.workspace, clientID: registration.clientID, token, capabilities },
      { headers: authHeaders(gui), throwOnError: true },
    )))
    void register().catch((cause) => console.error("GUI bridge registration failed", cause))
    const renewal = window.setInterval(() => void register().catch((cause) => console.error("GUI bridge renewal failed", cause)), 20_000)
    onCleanup(() => {
      window.clearInterval(renewal)
      registrations.forEach((registration) => activeClientIDs.delete(registration.clientID))
      void Promise.all(registrations.map((registration) => gui.client.opencodex.guiBridge.unregister(
        { directory: registration.directory || undefined, workspace: registration.workspace, clientID: registration.clientID, token },
        { headers: authHeaders(gui), throwOnError: true },
      ))).catch((cause) => console.error("GUI bridge cleanup failed", cause))
    })
  })

  onCleanup(unsubscribe)

  async function handle(request: GuiBridgeRequest) {
    const gui = input.authoritative.client()
    if (!gui) return
    const session = input.authoritative.snapshot()?.sessions.find((item) => item.id === request.sessionID)
      ?? input.selection.visibleSessions().find((item) => item.id === request.sessionID)
    if (!session) {
      await respondError(gui, request, token, `Session ${request.sessionID} is not available in this GUI.`)
      return
    }

    if (input.navigation.route().name === "views" && input.view.sessions().some((item) => item.id === request.sessionID)) {
      input.view.openSidePanel(request.sessionID, { tab: "open" })
    } else {
      input.navigation.setRoute({ name: "session", sessionID: request.sessionID })
      openSessionWorkspace(request.sessionID, { tab: "open" })
    }

    const result = await requestSessionWorkspace(request.sessionID, request).then(
      (value) => value.operation === request.operation ? value : Promise.reject(new Error("The session workspace returned a mismatched operation.")),
      (cause) => Promise.reject(cause),
    ).catch((cause) => ({ status: "error" as const, message: guiBridgeErrorMessage(cause) }))
    if ("status" in result) {
      await respondError(gui, request, token, result.message)
      return
    }
    await respondSuccess(gui, request, token, result)
  }

  return { clientID: baseClientID }
}

async function respondSuccess(gui: GuiClient, request: GuiBridgeRequest, token: string, result: SessionWorkspaceResult) {
  const common = { clientID: request.clientID, token, requestID: request.requestID }
  const options = { headers: authHeaders(gui), throwOnError: true } as const
  const scope = { directory: request.directory, workspace: request.workspace }
  if (result.operation === "workspace.open") return gui.client.opencodex.guiBridge.respond({ ...scope, body: { ...common, operation: result.operation, result: { status: "ok", output: result.output } } }, options)
  if (result.operation === "browser.navigate") return gui.client.opencodex.guiBridge.respond({ ...scope, body: { ...common, operation: result.operation, result: { status: "ok", output: result.output } } }, options)
  if (result.operation === "browser.state") return gui.client.opencodex.guiBridge.respond({ ...scope, body: { ...common, operation: result.operation, result: { status: "ok", output: result.output } } }, options)
  if (result.operation === "browser.screenshot") return gui.client.opencodex.guiBridge.respond({ ...scope, body: { ...common, operation: result.operation, result: { status: "ok", output: result.output } } }, options)
  return gui.client.opencodex.guiBridge.respond({ ...scope, body: { ...common, operation: result.operation, result: { status: "ok", output: result.output } } }, options)
}

async function respondError(gui: GuiClient, request: GuiBridgeRequest, token: string, message: string) {
  const common = { clientID: request.clientID, token, requestID: request.requestID }
  const result = { status: "error" as const, message }
  const options = { headers: authHeaders(gui), throwOnError: true } as const
  const scope = { directory: request.directory, workspace: request.workspace }
  if (request.operation === "workspace.open") return gui.client.opencodex.guiBridge.respond({ ...scope, body: { ...common, operation: request.operation, result } }, options)
  if (request.operation === "browser.navigate") return gui.client.opencodex.guiBridge.respond({ ...scope, body: { ...common, operation: request.operation, result } }, options)
  if (request.operation === "browser.state") return gui.client.opencodex.guiBridge.respond({ ...scope, body: { ...common, operation: request.operation, result } }, options)
  if (request.operation === "browser.screenshot") return gui.client.opencodex.guiBridge.respond({ ...scope, body: { ...common, operation: request.operation, result } }, options)
  return gui.client.opencodex.guiBridge.respond({ ...scope, body: { ...common, operation: request.operation, result } }, options)
}

function clientIDForScope(scope: ReturnType<typeof guiBridgeScopes>[number], baseClientID: string, ids: Map<string, string>) {
  const key = `${scope.directory}\n${scope.workspace ?? ""}`
  const existing = ids.get(key)
  if (existing) return existing
  const id = `${baseClientID}-${ids.size + 1}`
  ids.set(key, id)
  return id
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
}
