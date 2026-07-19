import { WorkspaceRef } from "@/effect/instance-ref"
import { InstanceState } from "@/effect/instance-state"
import { GuiBridge } from "@/opencodex/gui-bridge"
import { Effect } from "effect"
import { ConflictError, ForbiddenError, InvalidRequestError } from "../errors"

function mapError(error: GuiBridge.ResponseError) {
  if (error._tag === "GuiBridgeAuthenticationError") {
    return new ForbiddenError({ message: error.message })
  }
  if (error._tag === "GuiBridgeRequestNotFoundError" || error._tag === "GuiBridgeRegistrationNotFoundError") {
    return new ConflictError({
      message: error.message,
      resource: error._tag === "GuiBridgeRequestNotFoundError" ? error.requestID : error.clientID,
    })
  }
  return new InvalidRequestError({ message: error.message, kind: "gui_bridge_response_mismatch" })
}

export const makeOpencodeXGuiBridgeHandlers = Effect.fn("OpencodeXHttpApi.guiBridgeHandlers")(function* () {
  const bridge = yield* GuiBridge.Service

  const scope = Effect.fnUntraced(function* () {
    const instance = yield* InstanceState.context
    const workspaceID = yield* WorkspaceRef
    return { directory: instance.directory, workspaceID }
  })

  const guiBridgeRegister = Effect.fn("OpencodeXHttpApi.guiBridgeRegister")(function* (ctx: {
    payload: typeof GuiBridge.RegisterPayload.Type
  }) {
    yield* bridge
      .register(new GuiBridge.Registration({ ...ctx.payload, ...(yield* scope()), expiresAt: Date.now() + 45_000 }))
      .pipe(Effect.mapError(mapError))
    return { ok: true as const }
  })

  const guiBridgeUnregister = Effect.fn("OpencodeXHttpApi.guiBridgeUnregister")(function* (ctx: {
    payload: typeof GuiBridge.ClientPayload.Type
  }) {
    yield* bridge.unregister({ ...ctx.payload, ...(yield* scope()) }).pipe(Effect.mapError(mapError))
    return { ok: true as const }
  })

  const guiBridgeRespond = Effect.fn("OpencodeXHttpApi.guiBridgeRespond")(function* (ctx: {
    payload: GuiBridge.RespondPayload
  }) {
    yield* bridge.respond(ctx.payload).pipe(Effect.mapError(mapError))
    return { ok: true as const }
  })

  return { guiBridgeRegister, guiBridgeUnregister, guiBridgeRespond }
})
