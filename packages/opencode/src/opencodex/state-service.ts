import { Database } from "@opencode-ai/core/database/database"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Permission } from "@/permission"
import { Question } from "@/question"
import { Session } from "@/session/session"
import { SessionStatus } from "@/session/status"
import { Todo } from "@/session/todo"
import { Effect, Layer } from "effect"
import { OpencodeXJob } from "./job"
import { OpencodeXProject } from "./project"
import { makeStateLog } from "./state-log"
import { makeStateReader } from "./state-reader"
import { Service } from "./state-schema"
import { OpencodeXSessionState } from "./session-state"
import { OpencodeXSwarm } from "./swarm"
import { OpencodeXView } from "./view"

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const events = yield* EventV2Bridge.Service
    const log = yield* makeStateLog(database.db, events)
    const reader = yield* makeStateReader(database, events, log)
    return Service.of({
      scope: log.scope,
      barrier: events.barrier,
      cursor: log.cursor,
      replay: log.replay,
      listen: log.listen,
      snapshot: reader.snapshot,
      operations: reader.operations,
      session: reader.session,
    })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Database.defaultLayer),
  Layer.provide(EventV2Bridge.defaultLayer),
  Layer.provide(OpencodeXProject.defaultLayer),
  Layer.provide(OpencodeXJob.defaultLayer),
  Layer.provide(Session.defaultLayer),
  Layer.provide(OpencodeXSwarm.readLayer.pipe(Layer.provide(Database.defaultLayer))),
  Layer.provide(OpencodeXView.defaultLayer),
  Layer.provide(SessionStatus.defaultLayer),
  Layer.provide(Permission.defaultLayer),
  Layer.provide(Question.defaultLayer),
  Layer.provide(OpencodeXSessionState.defaultLayer),
  Layer.provide(Todo.defaultLayer),
)
