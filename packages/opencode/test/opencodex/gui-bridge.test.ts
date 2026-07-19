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

function registration(capabilities: GuiBridge.Operation[]) {
  return new GuiBridge.Registration({ clientID, token, directory, capabilities })
}

function nextRequest() {
  return Effect.gen(function* () {
    const deferred = yield* Deferred.make<GuiBridge.RequestID>()
    const events = yield* EventV2Bridge.Service
    const unsubscribe = yield* events.listen((event) => {
      if (event.type !== GuiBridge.Event.Request.type) return Effect.void
      if (!event.data || typeof event.data !== "object" || !("requestID" in event.data)) return Effect.void
      if (typeof event.data.requestID !== "string") return Effect.void
      return Deferred.succeed(deferred, GuiBridge.RequestID.make(event.data.requestID)).pipe(Effect.asVoid)
    })
    yield* Effect.addFinalizer(() => unsubscribe)
    return deferred
  })
}

describe("GuiBridge", () => {
  it.effect("authenticates registration ownership and unregister", () =>
    Effect.gen(function* () {
      const bridge = yield* GuiBridge.Service
      yield* bridge.register(registration(["workspace.open"]))

      const replaceError = yield* bridge
        .register(
          new GuiBridge.Registration({ clientID, token: otherToken, directory, capabilities: ["workspace.open"] }),
        )
        .pipe(Effect.flip)
      expect(replaceError).toBeInstanceOf(GuiBridge.AuthenticationError)

      const unregisterError = yield* bridge.unregister({ clientID, token: otherToken, directory }).pipe(Effect.flip)
      expect(unregisterError).toBeInstanceOf(GuiBridge.AuthenticationError)

      yield* bridge.unregister({ clientID, token, directory })
      expect(yield* bridge.capabilities({ directory })).toEqual([])
    }),
  )

  it.effect("requires matching token, request, and operation and rejects late responses", () =>
    Effect.gen(function* () {
      const bridge = yield* GuiBridge.Service
      const published = yield* nextRequest()
      yield* bridge.register(registration(["browser.navigate", "browser.snapshot"]))
      const fiber = yield* bridge
        .request({
          directory,
          sessionID,
          operation: "browser.navigate",
          input: { url: "https://example.com/" },
        })
        .pipe(Effect.forkScoped)
      const requestID = yield* Deferred.await(published)

      const authError = yield* bridge
        .respond({
          clientID,
          token: otherToken,
          requestID,
          operation: "browser.navigate",
          result: { status: "ok", output: { url: "https://example.com/" } },
        })
        .pipe(Effect.flip)
      expect(authError).toBeInstanceOf(GuiBridge.AuthenticationError)

      const correlationError = yield* bridge
        .respond({
          clientID,
          token,
          requestID,
          operation: "browser.snapshot",
          result: { status: "ok", output: { url: "https://example.com/", text: "wrong operation" } },
        })
        .pipe(Effect.flip)
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

      const lateError = yield* bridge.respond(response).pipe(Effect.flip)
      expect(lateError).toBeInstanceOf(GuiBridge.RequestNotFoundError)
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

  it.effect("filters expired registrations and accepts lease renewal across scopes", () =>
    Effect.gen(function* () {
      const bridge = yield* GuiBridge.Service
      const workspaceID = WorkspaceV2.ID.make("wrk_gui_bridge_test")
      const scopedClientID = GuiBridge.ClientID.make("gui-test-workspace")
      yield* bridge.register(new GuiBridge.Registration({
        clientID,
        token,
        directory,
        capabilities: ["workspace.open"],
        expiresAt: Date.now() - 1,
      }))
      yield* bridge.register(new GuiBridge.Registration({
        clientID: scopedClientID,
        token,
        directory,
        workspaceID,
        capabilities: ["browser.navigate"],
        expiresAt: Date.now() + 45_000,
      }))

      expect(yield* bridge.capabilities({ directory })).toEqual([])
      expect(yield* bridge.capabilities({ directory, workspaceID })).toEqual(["browser.navigate"])

      yield* bridge.register(new GuiBridge.Registration({
        clientID,
        token,
        directory,
        capabilities: ["workspace.open"],
        expiresAt: Date.now() + 45_000,
      }))
      expect(yield* bridge.capabilities({ directory })).toEqual(["workspace.open"])
      expect(yield* bridge.capabilities({ directory, workspaceID })).toEqual(expect.arrayContaining(["workspace.open", "browser.navigate"]))
      expect(yield* bridge.capabilities({ directory, workspaceID })).toHaveLength(2)
    }),
  )

  it.live("times out, cleans up, and rejects the late response", () =>
    Effect.gen(function* () {
      const bridge = yield* GuiBridge.Service
      const published = yield* nextRequest()
      yield* bridge.register(registration(["browser.state"]))
      const fiber = yield* bridge
        .request({ directory, sessionID, operation: "browser.state", input: {}, timeout: "10 millis" })
        .pipe(Effect.flip, Effect.forkScoped)
      const requestID = yield* Deferred.await(published)
      expect(yield* Fiber.join(fiber)).toBeInstanceOf(GuiBridge.TimeoutError)

      const lateError = yield* bridge
        .respond({
          clientID,
          token,
          requestID,
          operation: "browser.state",
          result: { status: "ok", output: { url: "" } },
        })
        .pipe(Effect.flip)
      expect(lateError).toBeInstanceOf(GuiBridge.RequestNotFoundError)
    }),
  )
})
