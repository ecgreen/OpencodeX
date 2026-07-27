import { Database } from "@opencode-ai/core/database/database"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Effect, Layer } from "effect"
import { createJobLifecycle } from "./job-lifecycle"
import { Service } from "./job-schema"
import { createJobStore } from "./job-store"

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const events = yield* EventV2Bridge.Service
    const store = createJobStore(database.db, events)
    const lifecycle = createJobLifecycle(database.db, events, store)
    return Service.of({
      list: store.list,
      get: store.get,
      create: store.create,
      update: store.update,
      claim: lifecycle.claim,
      start: lifecycle.start,
      renew: lifecycle.renew,
      succeed: lifecycle.succeed,
      fail: lifecycle.fail,
      settle: lifecycle.settle,
      retry: lifecycle.retry,
      cancel: lifecycle.cancel,
      acknowledgeCancel: lifecycle.acknowledgeCancel,
      recover: lifecycle.recover,
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Database.defaultLayer), Layer.provide(EventV2Bridge.defaultLayer))
