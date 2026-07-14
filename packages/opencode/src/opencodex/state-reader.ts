import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { Permission } from "@/permission"
import { Question } from "@/question"
import { MessageV2 } from "@/session/message-v2"
import { SessionID } from "@/session/schema"
import { Session } from "@/session/session"
import { SessionStatus } from "@/session/status"
import { Todo } from "@/session/todo"
import { Effect } from "effect"
import { OpencodeXJob } from "./job"
import { OpencodeXProject } from "./project"
import { groupBySession, encodeCursor, revision } from "./state-event"
import { EPOCH } from "./state-schema"
import type { StateLog } from "./state-log"
import { OpencodeXSessionState } from "./session-state"
import { OpencodeXSwarm } from "./swarm"
import { OpencodeXView } from "./view"

export const makeStateReader = Effect.fn("OpencodeXState.makeReader")(function* (
  database: Database.Interface,
  events: EventV2.Interface,
  log: StateLog,
) {
  const projects = yield* OpencodeXProject.Service
  const jobs = yield* OpencodeXJob.Service
  const sessions = yield* Session.Service
  const swarms = yield* OpencodeXSwarm.ReadService
  const views = yield* OpencodeXView.Service
  const statuses = yield* SessionStatus.Service
  const permissions = yield* Permission.Service
  const questions = yield* Question.Service
  const sessionState = yield* OpencodeXSessionState.Service
  const todos = yield* Todo.Service

  const readOperations = Effect.fn("OpencodeXState.readOperations")(function* () {
    const [jobList, swarmList] = yield* Effect.all([jobs.list(), swarms.list()], { concurrency: "unbounded" })
    return { jobs: jobList, swarms: swarmList }
  })

  const snapshot = Effect.fn("OpencodeXState.snapshot")(function* () {
    return yield* events.barrier(
      Effect.gen(function* () {
        const scope = yield* log.scope()
        const [sessionList, globalSessions, statusList, permissionList, questionList, operations] = yield* Effect.all(
          [
            sessions.list({ scope: "project" }),
            sessions.listGlobal({ limit: 5_000 }),
            statuses.list(),
            permissions.list(),
            questions.list(),
            readOperations(),
          ],
          { concurrency: "unbounded" },
        )
        const [projectList, viewList] = yield* Effect.all(
          [
            projects.list({ sessions: globalSessions.filter((session) => !session.parentID) }),
            views.list({ sessions: globalSessions }),
          ],
          { concurrency: "unbounded" },
        )
        const state = yield* sessionState.list(sessionList.map((session) => session.id))
        const permissionsBySession = groupBySession(permissionList)
        const questionsBySession = groupBySession(questionList)
        const catalog = {
          projects: projectList,
          sessions: sessionList,
          views: viewList,
          sessionStatus: Object.fromEntries(statusList),
          permissions: permissionList,
          questions: questionList,
          sessionUiState: Object.fromEntries(
            sessionList.map((session) => [
              session.id,
              OpencodeXSessionState.deriveUiState({
                session,
                status: statusList.get(session.id),
                permissions: permissionsBySession.get(session.id) ?? [],
                questions: questionsBySession.get(session.id) ?? [],
                state: state[session.id],
              }),
            ]),
          ),
        }
        const revisions = yield* log.revisionVector(scope)
        const catalogDigest = revision(revisions.catalog)
        const operationsDigest = revision(revisions.operations)
        return {
          scope,
          epoch: EPOCH,
          cursor: encodeCursor(scope, Math.max(...Object.values(revisions))),
          digest: `${catalogDigest}.${operationsDigest}`,
          domains: {
            catalog: { revision: catalogDigest, digest: catalogDigest },
            operations: { revision: operationsDigest, digest: operationsDigest },
          },
          payloads: { catalog, operations },
        }
      }),
    )
  })

  const operations = Effect.fn("OpencodeXState.operations")(function* () {
    return yield* events.barrier(
      Effect.gen(function* () {
        const scope = yield* log.scope()
        const [payload, revisions] = yield* Effect.all([readOperations(), log.revisionVector(scope)], {
          concurrency: "unbounded",
        })
        const operationsRevision = revision(revisions.operations)
        return {
          scope,
          epoch: EPOCH,
          cursor: encodeCursor(scope, Math.max(...Object.values(revisions))),
          revision: operationsRevision,
          digest: operationsRevision,
          payload,
        }
      }),
    )
  })

  const session = Effect.fn("OpencodeXState.session")(function* (input: {
    sessionID: SessionID
    limit?: number
    before?: string
  }) {
    return yield* events.barrier(
      Effect.gen(function* () {
        const scope = yield* log.scope()
        const [info, page, todoList, diff, permissionList, questionList] = yield* Effect.all(
          [
            sessions.get(input.sessionID),
            MessageV2.page({ sessionID: input.sessionID, limit: input.limit ?? 50, before: input.before }).pipe(
              Effect.provideService(Database.Service, database),
            ),
            todos.get(input.sessionID),
            sessions.diff(input.sessionID),
            permissions.list().pipe(Effect.map((items) => items.filter((item) => item.sessionID === input.sessionID))),
            questions.list().pipe(Effect.map((items) => items.filter((item) => item.sessionID === input.sessionID))),
          ],
          { concurrency: "unbounded" },
        )
        const firstMessage = page.items[0]
        const lastMessage = page.items.at(-1)
        const content = {
          session: info,
          messages: {
            items: page.items,
            coverage: {
              ...(firstMessage ? { firstMessageID: firstMessage.info.id } : {}),
              ...(lastMessage ? { lastMessageID: lastMessage.info.id } : {}),
            },
            boundary: { hasMore: page.more, ...(page.cursor ? { next: page.cursor } : {}) },
          },
          todos: todoList,
          diff,
          pendingInteractions: { permissions: permissionList, questions: questionList },
        }
        return {
          scope,
          epoch: EPOCH,
          cursor: encodeCursor(scope, yield* log.position(scope)),
          digest: Bun.hash(JSON.stringify(content)).toString(36),
          ...content,
        }
      }),
    )
  })

  return { snapshot, operations, session }
})
