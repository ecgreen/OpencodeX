import { EventV2 } from "@opencode-ai/core/event"
import { ProjectV2 } from "@opencode-ai/core/project"
import { NonNegativeInt } from "@opencode-ai/core/schema"
import { SessionLegacy } from "@opencode-ai/core/session/legacy"
import { WorkspaceV2 } from "@opencode-ai/core/workspace"
import { Permission } from "@/permission"
import { Question } from "@/question"
import { SessionID } from "@/session/schema"
import { Session } from "@/session/session"
import { Todo } from "@/session/todo"
import { Snapshot } from "@/snapshot"
import { Context, Effect, Schema } from "effect"
import { Info as OpencodeXGoalInfo } from "./goal-schema"
import { OpencodeXJob } from "./job"
import { OpencodeXProject } from "./project"
import { OpencodeXSessionCard } from "./session-card"
import { OpencodeXSessionState } from "./session-state"
import { OpencodeXSwarm } from "./swarm"
import { OpencodeXTerminalSession } from "./terminal-session"
import { OpencodeXView } from "./view"
import { SessionStatus } from "@/session/status"

export const EPOCH = "2026-07-24.1"

export const OpencodeXStateScope = Schema.Struct({
  projectID: ProjectV2.ID,
  workspaceID: Schema.optional(WorkspaceV2.ID),
  directory: Schema.String,
}).annotate({ identifier: "OpencodeXStateScope" })
export type OpencodeXStateScope = Schema.Schema.Type<typeof OpencodeXStateScope>

export const OpencodeXStateCursor = Schema.String.pipe(Schema.brand("OpencodeXStateCursor")).annotate({
  identifier: "OpencodeXStateCursor",
})
export type OpencodeXStateCursor = Schema.Schema.Type<typeof OpencodeXStateCursor>

const MessagePage = Schema.Struct({
  items: Schema.Array(SessionLegacy.WithParts),
  coverage: Schema.Struct({
    firstMessageID: Schema.optional(Schema.String),
    lastMessageID: Schema.optional(Schema.String),
  }),
  boundary: Schema.Struct({
    hasMore: Schema.Boolean,
    next: Schema.optional(Schema.String),
  }),
})

const StateDomainRevision = Schema.Struct({ revision: Schema.String, digest: Schema.String })

const OperationsPayload = Schema.Struct({
  jobs: Schema.Array(OpencodeXJob.Info),
  swarms: Schema.Array(OpencodeXSwarm.Info),
  goals: Schema.Array(OpencodeXGoalInfo),
})

export const OpencodeXCatalogSnapshot = Schema.Struct({
  projects: Schema.Array(OpencodeXProject.CatalogInfo),
  sessionCards: OpencodeXSessionCard.Page,
  terminalSessions: Schema.Array(OpencodeXTerminalSession.Info),
  views: Schema.Array(OpencodeXView.CatalogInfo),
  sessionStatus: Schema.Record(Schema.String, SessionStatus.Info),
  permissions: Schema.Array(Permission.Request),
  questions: Schema.Array(Question.Request),
  sessionUiState: Schema.Record(Schema.String, OpencodeXSessionState.UiState),
}).annotate({ identifier: "OpencodeXCatalogSnapshot" })
export type OpencodeXCatalogSnapshot = Schema.Schema.Type<typeof OpencodeXCatalogSnapshot>

export const OpencodeXStateSnapshot = Schema.Struct({
  scope: OpencodeXStateScope,
  epoch: Schema.String,
  cursor: OpencodeXStateCursor,
  digest: Schema.String,
  domains: Schema.Struct({
    catalog: StateDomainRevision,
    operations: StateDomainRevision,
  }),
  payloads: Schema.Struct({
    catalog: OpencodeXCatalogSnapshot,
    operations: OperationsPayload,
  }),
}).annotate({ identifier: "OpencodeXStateSnapshot" })
export type OpencodeXStateSnapshot = Schema.Schema.Type<typeof OpencodeXStateSnapshot>

export const OpencodeXOperationsSnapshot = Schema.Struct({
  scope: OpencodeXStateScope,
  epoch: Schema.String,
  cursor: OpencodeXStateCursor,
  revision: Schema.String,
  digest: Schema.String,
  payload: OperationsPayload,
}).annotate({ identifier: "OpencodeXOperationsSnapshot" })
export type OpencodeXOperationsSnapshot = Schema.Schema.Type<typeof OpencodeXOperationsSnapshot>

export const OpencodeXSessionSnapshot = Schema.Struct({
  scope: OpencodeXStateScope,
  epoch: Schema.String,
  cursor: OpencodeXStateCursor,
  digest: Schema.String,
  session: Session.Info,
  messages: MessagePage,
  todos: Schema.Array(Todo.Info),
  diff: Schema.Array(Snapshot.FileDiff),
  pendingInteractions: Schema.Struct({
    permissions: Schema.Array(Permission.Request),
    questions: Schema.Array(Question.Request),
  }),
}).annotate({ identifier: "OpencodeXSessionSnapshot" })
export type OpencodeXSessionSnapshot = Schema.Schema.Type<typeof OpencodeXSessionSnapshot>

export const OpencodeXStateEvent = Schema.Struct({
  id: EventV2.ID,
  scope: OpencodeXStateScope,
  epoch: Schema.String,
  cursor: OpencodeXStateCursor,
  position: NonNegativeInt,
  visibility: Schema.Literals(["global", "instance"]),
  aggregateSequence: NonNegativeInt,
  domain: Schema.Literals(["capabilities", "catalog", "operations", "session"]),
  operation: Schema.Literal("invalidate"),
  payload: Schema.Struct({ aggregateID: Schema.String, eventType: Schema.String }),
}).annotate({ identifier: "OpencodeXStateEvent" })
export type OpencodeXStateEvent = Schema.Schema.Type<typeof OpencodeXStateEvent>

export const OpencodeXStateStreamFrame = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("ready"),
    scope: OpencodeXStateScope,
    epoch: Schema.String,
    cursor: OpencodeXStateCursor,
  }),
  Schema.Struct({ type: Schema.Literal("event"), event: OpencodeXStateEvent }),
  Schema.Struct({ type: Schema.Literal("heartbeat"), epoch: Schema.String }),
  Schema.Struct({
    type: Schema.Literal("reset_required"),
    scope: OpencodeXStateScope,
    epoch: Schema.String,
    cursor: OpencodeXStateCursor,
    reason: Schema.String,
  }),
]).annotate({ identifier: "OpencodeXStateStreamFrame" })
export type OpencodeXStateStreamFrame = Schema.Schema.Type<typeof OpencodeXStateStreamFrame>

export const CursorPayload = Schema.Struct({
  epoch: Schema.String,
  databaseID: Schema.String,
  scope: OpencodeXStateScope,
  position: NonNegativeInt,
})

export type Replay =
  | { readonly reset: true; readonly reason: string; readonly cursor: OpencodeXStateCursor; readonly position: number }
  | {
      readonly reset: false
      readonly events: readonly OpencodeXStateEvent[]
      readonly cursor: OpencodeXStateCursor
      readonly position: number
    }

export interface Interface {
  readonly scope: () => Effect.Effect<OpencodeXStateScope>
  readonly barrier: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
  readonly cursor: () => Effect.Effect<OpencodeXStateCursor>
  readonly replay: (after?: string) => Effect.Effect<Replay>
  readonly listen: (listener: (event: OpencodeXStateEvent) => void) => Effect.Effect<Effect.Effect<void>>
  readonly snapshot: () => Effect.Effect<OpencodeXStateSnapshot>
  readonly operations: () => Effect.Effect<OpencodeXOperationsSnapshot>
  readonly sessionCards: (input?: {
    cursor?: string
    limit?: number
    sessionIDs?: readonly SessionID[]
  }) => Effect.Effect<OpencodeXSessionCard.Page, OpencodeXSessionCard.InvalidCursorError>
  readonly session: (input: {
    sessionID: SessionID
    limit?: number
    before?: string
  }) => Effect.Effect<OpencodeXSessionSnapshot, Session.NotFound>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/OpencodeXState") {}
