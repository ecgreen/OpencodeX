import { InstanceState } from "@/effect/instance-state"
import { SessionID } from "./schema"
import { NonNegativeInt } from "@opencode-ai/core/schema"
import { Effect, Layer, Context, Schema } from "effect"
import { EventV2Bridge } from "@/event-v2-bridge"
import { EventV2 } from "@opencode-ai/core/event"

export const Info = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("idle"),
  }),
  Schema.Struct({
    type: Schema.Literal("retry"),
    attempt: NonNegativeInt,
    message: Schema.String,
    action: Schema.optional(
      Schema.Struct({
        reason: Schema.String,
        provider: Schema.String,
        title: Schema.String,
        message: Schema.String,
        label: Schema.String,
        link: Schema.optional(Schema.String),
      }),
    ),
    next: NonNegativeInt,
  }),
  Schema.Struct({
    type: Schema.Literal("busy"),
  }),
]).annotate({ identifier: "SessionStatus" })
export type Info = Schema.Schema.Type<typeof Info>

export const Event = {
  Status: EventV2.define({
    type: "session.status",
    sync: {
      aggregate: "sessionID",
      version: 1,
    },
    schema: {
      sessionID: SessionID,
      status: Info,
    },
  }),
  // deprecated
  Idle: EventV2.define({
    type: "session.idle",
    schema: {
      sessionID: SessionID,
    },
  }),
}

export interface Interface {
  readonly get: (sessionID: SessionID) => Effect.Effect<Info>
  readonly list: () => Effect.Effect<Map<SessionID, Info>>
  readonly set: (sessionID: SessionID, status: Info) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionStatus") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2Bridge.Service

    const state = yield* InstanceState.make(
      Effect.fn("SessionStatus.state")(() => Effect.succeed(new Map<SessionID, Info>())),
    )

    const apply = Effect.fn("SessionStatus.apply")(function* (sessionID: SessionID, status: Info) {
      const data = yield* InstanceState.get(state)
      if (status.type === "idle") data.delete(sessionID)
      else data.set(sessionID, status)
    })

    const unsubscribe = yield* events.listen((event) =>
      Effect.gen(function* () {
        if (event.type !== Event.Status.type) return
        const data = event.data as { sessionID: SessionID; status: Info }
        yield* apply(data.sessionID, data.status)
      }),
    )
    yield* Effect.addFinalizer(() => unsubscribe)

    const get = Effect.fn("SessionStatus.get")(function* (sessionID: SessionID) {
      const data = yield* InstanceState.get(state)
      return data.get(sessionID) ?? { type: "idle" as const }
    })

    const list = Effect.fn("SessionStatus.list")(function* () {
      return new Map(yield* InstanceState.get(state))
    })

    const set = Effect.fn("SessionStatus.set")(function* (sessionID: SessionID, status: Info) {
      yield* events.publish(Event.Status, { sessionID, status })
      if (status.type === "idle") {
        yield* events.publish(Event.Idle, { sessionID })
        yield* apply(sessionID, status)
        return
      }
      yield* apply(sessionID, status)
    })

    return Service.of({ get, list, set })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(EventV2Bridge.defaultLayer))

export * as SessionStatus from "./status"
