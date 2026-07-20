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
import { OpencodeXSessionCard, makeReader as makeSessionCardReader } from "./session-card"
import { groupBySession, encodeCursor, revision } from "./state-event"
import { EPOCH } from "./state-schema"
import type { StateLog } from "./state-log"
import { OpencodeXSessionState } from "./session-state"
import { OpencodeXSwarm } from "./swarm"
import { OpencodeXView } from "./view"

type SessionCardPage = {
  items: OpencodeXSessionCard.Card[]
  hasMore: boolean
  next?: OpencodeXSessionCard.Cursor
  missing: SessionID[]
}

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
  const sessionCards = makeSessionCardReader(database.db)

  const readOperations = Effect.fn("OpencodeXState.readOperations")(function* () {
    const [jobList, swarmList] = yield* Effect.all([jobs.list(), swarms.list()], { concurrency: "unbounded" })
    return { jobs: jobList, swarms: swarmList }
  })

  const withUiState = Effect.fn("OpencodeXState.withSessionCardUiState")(function* (
    cardPage: SessionCardPage,
    statusList: Map<SessionID, SessionStatus.Info>,
    permissionList: readonly Permission.Request[],
    questionList: readonly Question.Request[],
  ) {
    const state = yield* sessionState.list(cardPage.items.map((session) => session.id))
    const permissionsBySession = groupBySession(permissionList)
    const questionsBySession = groupBySession(questionList)
    return {
      ...cardPage,
      sessionUiState: Object.fromEntries(
        cardPage.items.map((session) => [
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
  })

  const snapshot = Effect.fn("OpencodeXState.snapshot")(function* () {
    return yield* events.barrier(
      Effect.gen(function* () {
        const scope = yield* log.scope()
        const [projectList, viewList, statusList, permissionList, questionList, operations, unseenReviewSessionIDs] = yield* Effect.all(
          [
            projects.listCatalog(),
            views.listCatalog(),
            statuses.list(),
            permissions.list(),
            questions.list(),
            readOperations(),
            sessionCards.unseenReviewIDs(),
          ],
          { concurrency: "unbounded" },
        )
        const cardPage = yield* sessionCards
          .initial(
            [
              ...permissionList.map((item) => item.sessionID),
              ...questionList.map((item) => item.sessionID),
              ...statusList.keys(),
              ...unseenReviewSessionIDs,
              ...operations.jobs.flatMap((job) =>
                job.sessionID && (job.status === "queued" || job.status === "claimed" || job.status === "running")
                  ? [job.sessionID]
                  : [],
              ),
              ...viewList.flatMap((view) => (view.focusedSessionID ? [view.focusedSessionID] : [])),
            ].filter((sessionID, index, all) => all.indexOf(sessionID) === index),
          )
          .pipe(Effect.flatMap((page) => withUiState(page, statusList, permissionList, questionList)))
        const catalog = {
          projects: projectList,
          sessionCards: cardPage,
          views: viewList,
          sessionStatus: Object.fromEntries(statusList),
          permissions: permissionList,
          questions: questionList,
          sessionUiState: cardPage.sessionUiState,
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

  const cards = Effect.fn("OpencodeXState.sessionCards")(function* (input?: {
    cursor?: string
    limit?: number
    sessionIDs?: readonly SessionID[]
  }) {
    return yield* events.barrier(
      Effect.gen(function* () {
        const [cardPage, statusList, permissionList, questionList] = yield* Effect.all(
          [sessionCards.page(input), statuses.list(), permissions.list(), questions.list()],
          { concurrency: "unbounded" },
        )
        return yield* withUiState(cardPage, statusList, permissionList, questionList)
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

  return { snapshot, operations, sessionCards: cards, session }
})
