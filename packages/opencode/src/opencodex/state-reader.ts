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
import { OpencodeXGoal } from "./goal"
import { OpencodeXJob } from "./job"
import { OpencodeXProject } from "./project"
import { OpencodeXSessionCard, makeReader as makeSessionCardReader } from "./session-card"
import { groupBySession, revision } from "./state-event"
import { EPOCH, type OpencodeXStateScope } from "./state-schema"
import type { StateLog } from "./state-log"
import { OpencodeXSessionState } from "./session-state"
import { OpencodeXSwarm } from "./swarm"
import { OpencodeXTerminalSession } from "./terminal-session"
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
  const goals = yield* OpencodeXGoal.ReadService
  const swarms = yield* OpencodeXSwarm.ReadService
  const terminalSessions = yield* OpencodeXTerminalSession.Service
  const views = yield* OpencodeXView.Service
  const statuses = yield* SessionStatus.Service
  const permissions = yield* Permission.Service
  const questions = yield* Question.Service
  const sessionState = yield* OpencodeXSessionState.Service
  const todos = yield* Todo.Service
  const sessionCards = makeSessionCardReader(database.db)

  const readOperations = Effect.fn("OpencodeXState.readOperations")(function* () {
    const [jobList, swarmList, goalList] = yield* Effect.all([jobs.list(), swarms.list(), goals.list()], {
      concurrency: "unbounded",
    })
    return { jobs: jobList, swarms: swarmList, goals: goalList }
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

  const readRootPayloads = Effect.fn("OpencodeXState.readRootPayloads")(function* (scope: OpencodeXStateScope) {
    while (true) {
      const before = yield* log.revisionVector(scope)
      const [
        projectList,
        terminalSessionList,
        viewList,
        statusList,
        permissionList,
        questionList,
        operations,
        unseenReviewSessionIDs,
      ] =
        yield* Effect.all(
          [
            projects.listCatalog(),
            terminalSessions.list(),
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
        terminalSessions: terminalSessionList,
        views: viewList,
        sessionStatus: Object.fromEntries(statusList),
        permissions: permissionList,
        questions: questionList,
        sessionUiState: cardPage.sessionUiState,
      }
      const revisions = yield* log.revisionVector(scope)
      if (
        revisions.catalog !== before.catalog ||
        revisions.operations !== before.operations
      )
        continue
      return { catalog, operations, revisions }
    }
  })

  const readStableOperations = Effect.fn("OpencodeXState.readStableOperations")(function* (scope: OpencodeXStateScope) {
    while (true) {
      const before = yield* log.revisionVector(scope)
      const payload = yield* readOperations()
      const revisions = yield* log.revisionVector(scope)
      if (revisions.operations !== before.operations) continue
      return { payload, revisions }
    }
  })

  const snapshot = Effect.fn("OpencodeXState.snapshot")(function* () {
    return yield* events.barrier(
      Effect.gen(function* () {
        const scope = yield* log.scope()
        const { catalog, operations, revisions } = yield* readRootPayloads(scope)
        const catalogDigest = revision(revisions.catalog)
        const operationsDigest = revision(revisions.operations)
        const payloads = { catalog, operations }
        return {
          scope,
          epoch: EPOCH,
          cursor: log.cursorAt(scope, Math.max(...Object.values(revisions))),
          digest: Bun.hash(JSON.stringify(payloads)).toString(36),
          domains: {
            catalog: { revision: catalogDigest, digest: Bun.hash(JSON.stringify(catalog)).toString(36) },
            operations: { revision: operationsDigest, digest: Bun.hash(JSON.stringify(operations)).toString(36) },
          },
          payloads,
        }
      }),
    )
  })

  const operations = Effect.fn("OpencodeXState.operations")(function* () {
    return yield* events.barrier(
      Effect.gen(function* () {
        const scope = yield* log.scope()
        const { payload, revisions } = yield* readStableOperations(scope)
        const operationsRevision = revision(revisions.operations)
        return {
          scope,
          epoch: EPOCH,
          cursor: log.cursorAt(scope, Math.max(...Object.values(revisions))),
          revision: operationsRevision,
          digest: Bun.hash(JSON.stringify(payload)).toString(36),
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
          cursor: log.cursorAt(scope, yield* log.position(scope)),
          digest: Bun.hash(JSON.stringify(content)).toString(36),
          ...content,
        }
      }),
    )
  })

  return { snapshot, operations, sessionCards: cards, session }
})
