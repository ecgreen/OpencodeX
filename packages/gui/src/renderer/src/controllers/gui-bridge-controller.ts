import { createEffect, createMemo, onCleanup, untrack } from "solid-js"
import {
  createGuiBridgeLease,
  GUI_BRIDGE_CAPABILITIES,
  guiBridgeDesiredState,
  guiBridgeErrorMessage,
  guiBridgeRequestMatchesSession,
  guiBridgeRequestFromEvent,
  type GuiBridgeRequest,
} from "../lib/gui-bridge"
import { authHeaders } from "../lib/session-api"
import { openSessionWorkspace, requestSessionWorkspace, type SessionWorkspaceResult } from "../lib/session-workspace-bridge"
import type { createAuthoritativeStateController } from "./authoritative-state-controller"
import type { createNavigationController } from "./navigation-controller"
import type { createSessionSelectionController } from "./session-selection-controller"
import type { createViewController } from "./view-controller"
import type { GuiClient } from "../lib/client"

export function createGuiBridgeController(input: {
  authoritative: ReturnType<typeof createAuthoritativeStateController>
  navigation: ReturnType<typeof createNavigationController>
  selection: ReturnType<typeof createSessionSelectionController>
  view: ReturnType<typeof createViewController>
}) {
  const baseClientID = `gui-${crypto.randomUUID()}`
  const token = randomToken()
  const tails = new Map<string, Promise<void>>()
  const activeRequests = new Set<string>()
  const completedRequests = new Set<string>()
  const completedRequestOrder: string[] = []
  const desired = createMemo(() => {
    const snapshot = input.authoritative.snapshot()
    const route = input.navigation.route()
    const prioritySessionIDs = [
      ...(route.name === "session" && route.sessionID ? [route.sessionID] : []),
      ...(route.name === "views" ? input.view.sessions().map((session) => session.id) : []),
      ...(snapshot?.permissions.map((request) => request.sessionID) ?? []),
      ...(snapshot?.questions.map((request) => request.sessionID) ?? []),
      ...(snapshot?.sessions.flatMap((session) => {
        const status = snapshot.sessionUiState[session.id]?.displayStatus
        return status === "input_needed" || status === "in_progress" ? [session.id] : []
      }) ?? []),
      ...(snapshot?.jobs.flatMap((job) =>
        job.sessionID && (job.status === "queued" || job.status === "claimed" || job.status === "running")
          ? [job.sessionID]
          : [],
      ) ?? []),
    ].filter((sessionID, index, all) => all.indexOf(sessionID) === index)
    const sessionsByID = new Map((snapshot?.sessions ?? []).map((session) => [session.id, session]))
    return guiBridgeDesiredState({
      clientID: baseClientID,
      token,
      capabilities: window.opencodex?.browser ? GUI_BRIDGE_CAPABILITIES : ["workspace.open"],
      directory: input.authoritative.client()?.directory ?? "",
      sessions: snapshot?.sessions ?? [],
      prioritySessions: prioritySessionIDs.flatMap((sessionID) => sessionsByID.get(sessionID) ?? []),
    })
  })
  let active: {
    authority: string
    lease: ReturnType<typeof createGuiBridgeLease>
    renewal: number
    setGui: (gui: GuiClient) => void
  } | undefined
  const unsubscribe = input.authoritative.subscribeGlobalEvents((event) => {
    const request = guiBridgeRequestFromEvent(event, baseClientID)
    if (!request || activeRequests.has(request.requestID) || completedRequests.has(request.requestID)) return
    activeRequests.add(request.requestID)
    const requestTask = (tails.get(request.sessionID) ?? Promise.resolve()).then(() => handle(request))
    const tail = requestTask.catch((cause) => {
      console.error("GUI bridge request failed", cause)
    })
    tails.set(request.sessionID, tail)
    void requestTask.then(
      () => rememberCompletedRequest(request.requestID),
      () => undefined,
    ).finally(() => {
      activeRequests.delete(request.requestID)
      if (tails.get(request.sessionID) === tail) tails.delete(request.sessionID)
    })
  })

  createEffect(() => {
    const gui = input.authoritative.client()
    if (!gui) {
      closeActiveLease()
      return
    }
    if (active?.authority === gui.url) {
      active.setGui(gui)
      return
    }
    closeActiveLease()
    const transport = { gui }
    const lease = createGuiBridgeLease({
      sync: (payload) => transport.gui.client.global.guiBridge.sync(payload, {
        headers: authHeaders(transport.gui),
        throwOnError: true,
      }).then((response) => response.data),
      unregister: (payload) => transport.gui.client.global.guiBridge.unregister(payload, {
        headers: authHeaders(transport.gui),
        throwOnError: true,
      }).then(() => undefined),
      onError: (operation, cause) => console.error(`GUI bridge ${operation} failed`, cause),
    })
    active = {
      authority: gui.url,
      lease,
      renewal: window.setInterval(() => void lease.renew(), 20_000),
      setGui: (next) => (transport.gui = next),
    }
    void lease.update(untrack(desired))
  })

  createEffect(() => {
    const gui = input.authoritative.client()
    const next = desired()
    const current = active
    if (!current || current.authority !== gui?.url) return
    void current.lease.update(next)
  })

  onCleanup(() => {
    closeActiveLease()
    unsubscribe()
  })

  function closeActiveLease() {
    if (!active) return
    const current = active
    active = undefined
    window.clearInterval(current.renewal)
    void current.lease.dispose()
  }

  function rememberCompletedRequest(requestID: string) {
    completedRequests.add(requestID)
    completedRequestOrder.push(requestID)
    while (completedRequestOrder.length > 2_000) {
      const stale = completedRequestOrder.shift()
      if (stale) completedRequests.delete(stale)
    }
  }

  async function handle(request: GuiBridgeRequest) {
    const gui = input.authoritative.client()
    if (!gui) return
    const session = input.authoritative.snapshot()?.sessions.find((item) => item.id === request.sessionID)
      ?? input.selection.visibleSessions().find((item) => item.id === request.sessionID)
    if (!session) {
      await respondError(gui, request, token, `Session ${request.sessionID} is not available in this GUI.`)
      return
    }
    if (!guiBridgeRequestMatchesSession(request, session)) {
      await respondError(gui, request, token, `Session ${request.sessionID} does not match the requested workspace scope.`)
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
  if (result.operation === "workspace.open") return gui.client.global.guiBridge.respond({ body: { ...common, operation: result.operation, result: { status: "ok", output: result.output } } }, options)
  if (result.operation === "browser.navigate") return gui.client.global.guiBridge.respond({ body: { ...common, operation: result.operation, result: { status: "ok", output: result.output } } }, options)
  if (result.operation === "browser.state") return gui.client.global.guiBridge.respond({ body: { ...common, operation: result.operation, result: { status: "ok", output: result.output } } }, options)
  if (result.operation === "browser.screenshot") return gui.client.global.guiBridge.respond({ body: { ...common, operation: result.operation, result: { status: "ok", output: result.output } } }, options)
  return gui.client.global.guiBridge.respond({ body: { ...common, operation: result.operation, result: { status: "ok", output: result.output } } }, options)
}

async function respondError(gui: GuiClient, request: GuiBridgeRequest, token: string, message: string) {
  const common = { clientID: request.clientID, token, requestID: request.requestID }
  const result = { status: "error" as const, message }
  const options = { headers: authHeaders(gui), throwOnError: true } as const
  if (request.operation === "workspace.open") return gui.client.global.guiBridge.respond({ body: { ...common, operation: request.operation, result } }, options)
  if (request.operation === "browser.navigate") return gui.client.global.guiBridge.respond({ body: { ...common, operation: request.operation, result } }, options)
  if (request.operation === "browser.state") return gui.client.global.guiBridge.respond({ body: { ...common, operation: request.operation, result } }, options)
  if (request.operation === "browser.screenshot") return gui.client.global.guiBridge.respond({ body: { ...common, operation: request.operation, result } }, options)
  return gui.client.global.guiBridge.respond({ body: { ...common, operation: request.operation, result } }, options)
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
}
