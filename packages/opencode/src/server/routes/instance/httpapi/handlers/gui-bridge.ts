import { GuiBridge } from "@/opencodex/gui-bridge"
import { Clock, Effect } from "effect"
import { ConflictError, ForbiddenError, InvalidRequestError } from "../errors"

function mapError(error: GuiBridge.ResponseError) {
  if (error._tag === "GuiBridgeAuthenticationError") {
    return new ForbiddenError({ message: error.message })
  }
  if (error._tag === "GuiBridgeRequestNotFoundError") {
    return new ConflictError({ message: error.message, resource: error.requestID })
  }
  return new InvalidRequestError({ message: error.message, kind: "gui_bridge_response_mismatch" })
}

export const makeGuiBridgeHandlers = Effect.fn("GlobalHttpApi.guiBridgeHandlers")(function* () {
  const bridge = yield* GuiBridge.Service

  const guiBridgeSync = Effect.fn("GlobalHttpApi.guiBridgeSync")(function* (ctx: {
    payload: typeof GuiBridge.SyncPayload.Type
  }) {
    const now = yield* Clock.currentTimeMillis
    return yield* bridge
      .sync(new GuiBridge.Registration({ ...ctx.payload, expiresAt: now + 45_000 }))
      .pipe(Effect.mapError(mapError))
  })

  const guiBridgeUnregister = Effect.fn("GlobalHttpApi.guiBridgeUnregister")(function* (ctx: {
    payload: typeof GuiBridge.UnregisterPayload.Type
  }) {
    yield* bridge.unregister(ctx.payload).pipe(Effect.mapError(mapError))
    return { ok: true as const }
  })

  const guiBridgeRespond = Effect.fn("GlobalHttpApi.guiBridgeRespond")(function* (ctx: {
    payload: GuiBridge.RespondPayload
  }) {
    yield* bridge.respond(ctx.payload).pipe(Effect.mapError(mapError))
    return { ok: true as const }
  })

  return { guiBridgeSync, guiBridgeUnregister, guiBridgeRespond }
})
