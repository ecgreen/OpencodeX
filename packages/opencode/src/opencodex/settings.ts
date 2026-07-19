import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Global } from "@opencode-ai/core/global"
import path from "path"
import { Context, Effect, Layer, Option, Ref, Schema } from "effect"

export const PermissionMode = Schema.Literals(["strict", "configured", "auto", "yolo"]).annotate({
  identifier: "OpencodeXPermissionMode",
  description: "Permission enforcement profile used only by OpenCodeX clients.",
})
export type PermissionMode = typeof PermissionMode.Type

export const Info = Schema.Struct({
  permission_mode: Schema.optional(PermissionMode),
}).annotate({ identifier: "OpencodeXSettings" })
export type Info = typeof Info.Type

export const UpdateInput = Schema.Struct({
  permission_mode: PermissionMode,
}).annotate({ identifier: "OpencodeXSettingsUpdateInput" })
export type UpdateInput = typeof UpdateInput.Type

export interface Interface {
  readonly get: () => Effect.Effect<Info>
  readonly update: (input: UpdateInput) => Effect.Effect<Info>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/OpencodeXSettings") {}

export const layer = (file = path.join(Global.Path.config, "opencodex.json")) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const fs = yield* AppFileSystem.Service
      const decode = Schema.decodeUnknownOption(Info)

      const get = Effect.fn("OpencodeXSettings.get")(function* () {
        const value = yield* fs.readJson(file).pipe(Effect.orElseSucceed(() => ({})))
        return Option.getOrElse(decode(value), () => ({}))
      })

      const update = Effect.fn("OpencodeXSettings.update")(function* (input: UpdateInput) {
        const next = { ...(yield* get()), ...input }
        yield* fs.writeJson(file, next).pipe(Effect.orDie)
        return next
      })

      return Service.of({ get, update })
    }),
  )

export const memory = (initial: Info = {}) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const state = yield* Ref.make(initial)
      return Service.of({
        get: Effect.fn("OpencodeXSettings.get")(function* () {
          return yield* Ref.get(state)
        }),
        update: Effect.fn("OpencodeXSettings.update")(function* (input: UpdateInput) {
          const next = { ...(yield* Ref.get(state)), ...input }
          yield* Ref.set(state, next)
          return next
        }),
      })
    }),
  )

export const defaultLayer = layer().pipe(Layer.provide(AppFileSystem.defaultLayer))

export * as OpencodeXSettings from "./settings"
