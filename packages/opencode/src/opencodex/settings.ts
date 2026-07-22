import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { EventV2 } from "@opencode-ai/core/event"
import { Global } from "@opencode-ai/core/global"
import { EffectFlock } from "@opencode-ai/core/util/effect-flock"
import { createHash, randomUUID } from "crypto"
import path from "path"
import { Context, Effect, Layer, Ref, Schema } from "effect"

export const PermissionMode = Schema.Literals(["strict", "configured", "auto", "yolo"]).annotate({
  identifier: "OpencodeXPermissionMode",
  description: "Permission enforcement profile used only by OpenCodeX clients.",
})
export type PermissionMode = typeof PermissionMode.Type

const Stored = Schema.Struct({
  permission_mode: Schema.optional(PermissionMode),
})
type Stored = typeof Stored.Type

export const Info = Schema.Struct({
  ...Stored.fields,
  revision: Schema.String,
}).annotate({ identifier: "OpencodeXSettings" })
export type Info = typeof Info.Type

export const UpdateInput = Schema.Struct({
  permission_mode: PermissionMode,
  expectedRevision: Schema.String,
}).annotate({ identifier: "OpencodeXSettingsUpdateInput" })
export type UpdateInput = typeof UpdateInput.Type

export const Event = {
  Updated: EventV2.define({
    type: "opencodex.settings.updated",
    schema: { revision: Schema.String },
  }),
}

export class InvalidSettingsError extends Schema.TaggedErrorClass<InvalidSettingsError>()(
  "OpencodeX.Settings.InvalidSettingsError",
  { path: Schema.String },
) {}

export class ConflictError extends Schema.TaggedErrorClass<ConflictError>()("OpencodeX.Settings.ConflictError", {
  expectedRevision: Schema.String,
  currentRevision: Schema.String,
}) {}

export interface Interface {
  readonly get: () => Effect.Effect<Info, InvalidSettingsError>
  readonly update: (input: UpdateInput) => Effect.Effect<Info, InvalidSettingsError | ConflictError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/OpencodeXSettings") {}

export const layer = (file = path.join(Global.Path.config, "opencodex.json")) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const fs = yield* AppFileSystem.Service
      const flock = yield* EffectFlock.Service
      const decodeJson = Schema.decodeUnknownEffect(Schema.UnknownFromJsonString)
      const decodeStored = Schema.decodeUnknownEffect(Stored)
      const revision = (raw?: string) =>
        createHash("sha256")
          .update(raw === undefined ? "missing\0" : `present\0${raw}`)
          .digest("hex")

      const read = Effect.fnUntraced(function* () {
        const raw = yield* fs
          .readFileStringSafe(file)
          .pipe(Effect.mapError(() => new InvalidSettingsError({ path: file })))
        if (raw === undefined) return { stored: {} as Record<string, unknown>, info: { revision: revision() } }
        const parsed = yield* decodeJson(raw).pipe(Effect.mapError(() => new InvalidSettingsError({ path: file })))
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          return yield* new InvalidSettingsError({ path: file })
        }
        const stored = yield* decodeStored(parsed).pipe(
          Effect.mapError(() => new InvalidSettingsError({ path: file })),
        )
        return { stored: Object.fromEntries(Object.entries(parsed)), info: { ...stored, revision: revision(raw) } }
      })

      const write = Effect.fnUntraced(function* (value: Record<string, unknown>) {
        const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${randomUUID()}.tmp`)
        yield* Effect.gen(function* () {
          yield* fs.makeDirectory(path.dirname(file), { recursive: true })
          yield* fs.writeFileString(temporary, JSON.stringify(value, null, 2))
          yield* fs.rename(temporary, file)
        }).pipe(Effect.ensuring(fs.remove(temporary).pipe(Effect.ignore)), Effect.orDie)
      })

      const get = Effect.fn("OpencodeXSettings.get")(function* () {
        return (yield* read()).info
      })

      const update = Effect.fn("OpencodeXSettings.update")(function* (input: UpdateInput) {
        return yield* flock
          .withLock(
            Effect.gen(function* () {
              const current = yield* read()
              if (current.info.revision !== input.expectedRevision) {
                return yield* new ConflictError({
                  expectedRevision: input.expectedRevision,
                  currentRevision: current.info.revision,
                })
              }
              const next = { ...current.stored, permission_mode: input.permission_mode }
              yield* write(next)
              return { permission_mode: input.permission_mode, revision: revision(JSON.stringify(next, null, 2)) }
            }),
            `opencodex-settings:${path.resolve(file)}`,
          )
          .pipe(
            Effect.catchTag("LockTimeoutError", (error) => Effect.die(error)),
            Effect.catchTag("LockCompromisedError", (error) => Effect.die(error)),
          )
      })

      return Service.of({ get, update })
    }),
  )

export const memory = (initial: Stored = {}) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const state = yield* Ref.make<Info>({ ...initial, revision: "0" })
      return Service.of({
        get: Effect.fn("OpencodeXSettings.get")(function* () {
          return yield* Ref.get(state)
        }),
        update: Effect.fn("OpencodeXSettings.update")(function* (input: UpdateInput) {
          const current = yield* Ref.get(state)
          if (current.revision !== input.expectedRevision) {
            return yield* new ConflictError({
              expectedRevision: input.expectedRevision,
              currentRevision: current.revision,
            })
          }
          const next = { permission_mode: input.permission_mode, revision: String(Number(current.revision) + 1) }
          yield* Ref.set(state, next)
          return next
        }),
      })
    }),
  )

export const defaultLayer = layer().pipe(
  Layer.provide(AppFileSystem.defaultLayer),
  Layer.provide(EffectFlock.defaultLayer),
)

export * as OpencodeXSettings from "./settings"
