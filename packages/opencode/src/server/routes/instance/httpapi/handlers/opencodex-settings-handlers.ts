import { OpencodeXSettings } from "@/opencodex/settings"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Effect } from "effect"
import { HttpApiError } from "effect/unstable/httpapi"
import { ConflictError } from "../errors"

export const makeOpencodeXSettingsHandlers = Effect.fn("OpencodeXHttpApi.makeSettingsHandlers")(function* () {
  const settings = yield* OpencodeXSettings.Service
  const events = yield* EventV2Bridge.Service

  const getSettings = Effect.fn("OpencodeXHttpApi.getSettings")(function* () {
    return yield* settings.get().pipe(
      Effect.catchTag("OpencodeX.Settings.InvalidSettingsError", () => Effect.fail(new HttpApiError.BadRequest({}))),
    )
  })

  const updateSettings = Effect.fn("OpencodeXHttpApi.updateSettings")(function* (ctx: {
    payload: OpencodeXSettings.UpdateInput
  }) {
    const updated = yield* settings.update(ctx.payload).pipe(
      Effect.catchTag("OpencodeX.Settings.InvalidSettingsError", () => Effect.fail(new HttpApiError.BadRequest({}))),
      Effect.catchTag("OpencodeX.Settings.ConflictError", (error) =>
        Effect.fail(
          new ConflictError({
            message: "The settings changed before this update was applied.",
            resource: error.currentRevision,
          }),
        ),
      ),
    )
    yield* events.publish(OpencodeXSettings.Event.Updated, { revision: updated.revision })
    return updated
  })

  return { getSettings, updateSettings }
})
