import { describe, expect } from "bun:test"
import { EventV2Bridge } from "@/event-v2-bridge"
import { GuiBridge } from "@/opencodex/gui-bridge"
import { SessionID } from "@/session/schema"
import { WorkspaceV2 } from "@opencode-ai/core/workspace"
import { Deferred, Effect, Fiber, Layer } from "effect"
import { testEffect } from "../lib/effect"

const clientID = GuiBridge.ClientID.make("gui-test")
const token = GuiBridge.Token.make("a".repeat(32))
const otherToken = GuiBridge.Token.make("b".repeat(32))
const directory = process.cwd()
const sessionID = SessionID.make("ses_gui_bridge_test")
const layer = GuiBridge.layer.pipe(Layer.provideMerge(EventV2Bridge.defaultLayer))
const it = testEffect(layer)

function registration(
  capabilities: GuiBridge.Operation[],
  scopes: GuiBridge.Scope[] = [{ directory }],
  registrationToken = token,
) {
  return new GuiBridge.Registration({ clientID, token: registrationToken, capabilities, scopes })
}

function nextRequest(expectedSessionID = sessionID) {
  return Effect.gen(function* () {
    const deferred = yield* Deferred.make<GuiBridge.RequestID>()
    const events = yield* EventV2Bridge.Service
    const unsubscribe = yield* events.listen((event) => {
      if (event.type !== GuiBridge.Event.Request.type) return Effect.void
      if (!event.data || typeof event.data !== "object" || !("requestID" in event.data)) return Effect.void
      if (!("sessionID" in event.data) || event.data.sessionID !== expectedSessionID) return Effect.void
      if (typeof event.data.requestID !== "string") return Effect.void
      return Deferred.succeed(deferred, GuiBridge.RequestID.make(event.data.requestID)).pipe(Effect.asVoid)
    })
    yield* Effect.addFinalizer(() => unsubscribe)
    return deferred
  })
}

describe("GuiBridge", () => {
  it.effect("authenticates ownership and makes stale generation cleanup harmless", () =>
    Effect.gen(function* () {
      const bridge = yield* GuiBridge.Service
      const first = yield* bridge.sync(registration(["workspace.open"]))

      const replaceError = yield* bridge.sync(registration(["workspace.open"], [{ directory }], otherToken)).pipe(Effect.flip)
      expect(replaceError).toBeInstanceOf(GuiBridge.AuthenticationError)

      const unregisterError = yield* bridge
        .unregister({ clientID, token: otherToken, generation: first.generation })
        .pipe(Effect.flip)
      expect(unregisterError).toBeInstanceOf(GuiBridge.AuthenticationError)

      const replacement = yield* bridge.sync(registration(["workspace.open"]))
      yield* bridge.unregister({ clientID, token, generation: first.generation })
      expect(yield* bridge.capabilities({ directory })).toEqual(["workspace.open"])

      yield* bridge.unregister({ clientID, token, generation: replacement.generation })
      expect(yield* bridge.capabilities({ directory })).toEqual([])
    }),
  )

  it.effect("syncs many scopes once and atomically reports unchanged, added, and removed scopes", () =>
    Effect.gen(function* () {
      const bridge = yield* GuiBridge.Service
      const scopes = Array.from({ length: 200 }, (_, index) => ({
        directory: `${directory}/scope-${index}`,
        workspaceID: WorkspaceV2.ID.make(`wrk_gui_bridge_${index}`),
      }))
      const first = yield* bridge.sync(registration(["browser.state"], scopes))
      expect(first).toMatchObject({ added: 200, removed: 0, unchanged: 0 })
      expect(yield* bridge.capabilities(scopes[137])).toEqual(["browser.state"])

      const renewed = yield* bridge.sync(registration(["browser.state"], scopes))
      expect(renewed).toMatchObject({ added: 0, removed: 0, unchanged: 200 })
      expect(renewed.generation).not.toBe(first.generation)

      const added = { directory: `${directory}/scope-new` }
      const changed = yield* bridge.sync(registration(["browser.state"], [...scopes.slice(1), added]))
      expect(changed).toMatchObject({ added: 1, removed: 1, unchanged: 199 })
      expect(yield* bridge.capabilities(scopes[0])).toEqual([])
      expect(yield* bridge.capabilities(added)).toEqual(["browser.state"])
    }),
  )

  it.effect("prunes expired client and scope indexes before accepting replacement ownership", () =>
    Effect.gen(function* () {
      const bridge = yield* GuiBridge.Service
      yield* bridge.sync(new GuiBridge.Registration({
        clientID,
        token,
        capabilities: ["workspace.open"],
        scopes: [{ directory }],
        expiresAt: -1,
      }))
      expect(yield* bridge.capabilities({ directory })).toEqual([])

      yield* bridge.sync(registration(["workspace.open"], [{ directory }], otherToken))
      expect(yield* bridge.capabilities({ directory })).toEqual(["workspace.open"])
    }),
  )

  it.effect("fails only pending operations affected by removed scopes and capabilities", () =>
    Effect.gen(function* () {
      const bridge = yield* GuiBridge.Service
      const firstDirectory = `${directory}/first`
      const secondDirectory = `${directory}/second`
      const firstSession = SessionID.make("ses_gui_bridge_first")
      const secondStateSession = SessionID.make("ses_gui_bridge_second_state")
      const secondNavigateSession = SessionID.make("ses_gui_bridge_second_navigate")
      const firstRequest = yield* nextRequest(firstSession)
      const secondStateRequest = yield* nextRequest(secondStateSession)
      const secondNavigateRequest = yield* nextRequest(secondNavigateSession)
      yield* bridge.sync(registration(["browser.state", "browser.navigate"], [
        { directory: firstDirectory },
        { directory: secondDirectory },
      ]))

      const first = yield* bridge.request({
        directory: firstDirectory,
        sessionID: firstSession,
        operation: "browser.state",
        input: {},
      }).pipe(Effect.flip, Effect.forkScoped)
      const secondState = yield* bridge.request({
        directory: secondDirectory,
        sessionID: secondStateSession,
        operation: "browser.state",
        input: {},
      }).pipe(Effect.flip, Effect.forkScoped)
      const secondNavigate = yield* bridge.request({
        directory: secondDirectory,
        sessionID: secondNavigateSession,
        operation: "browser.navigate",
        input: { url: "https://example.com/" },
      }).pipe(Effect.forkScoped)
      const [firstRequestID, secondStateRequestID, secondNavigateRequestID] = yield* Effect.all([
        Deferred.await(firstRequest),
        Deferred.await(secondStateRequest),
        Deferred.await(secondNavigateRequest),
      ])

      yield* bridge.sync(registration(["browser.navigate"], [{ directory: secondDirectory }]))
      expect(yield* Fiber.join(first)).toBeInstanceOf(GuiBridge.UnavailableError)
      expect(yield* Fiber.join(secondState)).toBeInstanceOf(GuiBridge.UnavailableError)

      yield* bridge.respond({
        clientID,
        token,
        requestID: secondNavigateRequestID,
        operation: "browser.navigate",
        result: { status: "ok", output: { url: "https://example.com/" } },
      })
      expect(yield* Fiber.join(secondNavigate)).toEqual({ url: "https://example.com/" })
      expect(firstRequestID).not.toBe(secondStateRequestID)
    }),
  )

  it.effect("correlates token, request, operation, and the scope retained by the pending request", () =>
    Effect.gen(function* () {
      const bridge = yield* GuiBridge.Service
      const published = yield* nextRequest()
      yield* bridge.sync(registration(["browser.navigate", "browser.snapshot"]))
      const fiber = yield* bridge.request({
        directory,
        sessionID,
        operation: "browser.navigate",
        input: { url: "https://example.com/" },
      }).pipe(Effect.forkScoped)
      const requestID = yield* Deferred.await(published)
      const renewed = yield* bridge.sync(registration(["browser.navigate", "browser.snapshot"]))
      expect(renewed.unchanged).toBe(1)

      const authError = yield* bridge.respond({
        clientID,
        token: otherToken,
        requestID,
        operation: "browser.navigate",
        result: { status: "ok", output: { url: "https://example.com/" } },
      }).pipe(Effect.flip)
      expect(authError).toBeInstanceOf(GuiBridge.AuthenticationError)

      const correlationError = yield* bridge.respond({
        clientID,
        token,
        requestID,
        operation: "browser.snapshot",
        result: { status: "ok", output: { url: "https://example.com/", text: "wrong operation" } },
      }).pipe(Effect.flip)
      expect(correlationError).toBeInstanceOf(GuiBridge.CorrelationError)

      const response = {
        clientID,
        token,
        requestID,
        operation: "browser.navigate" as const,
        result: { status: "ok" as const, output: { url: "https://example.com/" } },
      }
      yield* bridge.respond(response)
      expect(yield* Fiber.join(fiber)).toEqual({ url: "https://example.com/" })
      expect(yield* bridge.respond(response).pipe(Effect.flip)).toBeInstanceOf(GuiBridge.RequestNotFoundError)
    }),
  )

  it.effect("fails unavailable requests without publishing", () =>
    Effect.gen(function* () {
      const bridge = yield* GuiBridge.Service
      const error = yield* bridge
        .request({ directory, sessionID, operation: "workspace.open", input: { path: directory } })
        .pipe(Effect.flip)
      expect(error).toBeInstanceOf(GuiBridge.UnavailableError)
    }),
  )

  it.live("times out, cleans up, and rejects the late response", () =>
    Effect.gen(function* () {
      const bridge = yield* GuiBridge.Service
      const published = yield* nextRequest()
      yield* bridge.sync(registration(["browser.state"]))
      const fiber = yield* bridge
        .request({ directory, sessionID, operation: "browser.state", input: {}, timeout: "10 millis" })
        .pipe(Effect.flip, Effect.forkScoped)
      const requestID = yield* Deferred.await(published)
      expect(yield* Fiber.join(fiber)).toBeInstanceOf(GuiBridge.TimeoutError)

      const lateError = yield* bridge.respond({
        clientID,
        token,
        requestID,
        operation: "browser.state",
        result: { status: "ok", output: { url: "" } },
      }).pipe(Effect.flip)
      expect(lateError).toBeInstanceOf(GuiBridge.RequestNotFoundError)
    }),
  )
})
