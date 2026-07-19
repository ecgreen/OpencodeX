import { OpencodeXSettings } from "@/opencodex/settings"
import { Effect } from "effect"

export const makeOpencodeXSettingsHandlers = Effect.fn("OpencodeXHttpApi.makeSettingsHandlers")(function* () {
  const settings = yield* OpencodeXSettings.Service

  const getSettings = Effect.fn("OpencodeXHttpApi.getSettings")(function* () {
    return yield* settings.get()
  })

  const updateSettings = Effect.fn("OpencodeXHttpApi.updateSettings")(function* (ctx: {
    payload: OpencodeXSettings.UpdateInput
  }) {
    return yield* settings.update(ctx.payload)
  })

  return { getSettings, updateSettings }
})
