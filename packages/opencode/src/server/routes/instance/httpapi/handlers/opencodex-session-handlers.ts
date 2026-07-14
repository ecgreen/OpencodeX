import { OpencodeXProject } from "@/opencodex/project"
import { OpencodeXSessionState } from "@/opencodex/session-state"
import { OpencodeXView } from "@/opencodex/view"
import { Permission } from "@/permission"
import { Project } from "@/project/project"
import { Question } from "@/question"
import { SessionID } from "@/session/schema"
import { Session } from "@/session/session"
import { SessionStatus } from "@/session/status"
import { Effect } from "effect"
import { HttpApiError } from "effect/unstable/httpapi"
import { notFound, ProjectNotFoundError } from "../errors"
import {
  SessionSyncQuery,
  UpdateProjectPayload,
  UpdateSessionStatePayload,
} from "../groups/opencodex"
import * as SessionError from "./session-errors"

export const makeOpencodeXSessionHandlers = Effect.fn("OpencodeXHttpApi.makeSessionHandlers")(function* () {
  const projects = yield* OpencodeXProject.Service
  const sessions = yield* Session.Service
  const statuses = yield* SessionStatus.Service
  const permissions = yield* Permission.Service
  const questions = yield* Question.Service
  const sessionState = yield* OpencodeXSessionState.Service
  const views = yield* OpencodeXView.Service

  const listProjects = Effect.fn("OpencodeXHttpApi.listProjects")(function* () {
    return yield* projects.list()
  })

  const createProject = Effect.fn("OpencodeXHttpApi.createProject")(function* (ctx: {
    payload: OpencodeXProject.CreateInput
  }) {
    return yield* mapProjectErrors(projects.create(ctx.payload))
  })

  const validateProject = Effect.fn("OpencodeXHttpApi.validateProject")(function* (ctx: {
    payload: OpencodeXProject.ValidateInput
  }) {
    return yield* projects.validate(ctx.payload)
  })

  const updateProject = Effect.fn("OpencodeXHttpApi.updateProject")(function* (ctx: {
    params: { projectID: string }
    payload: typeof UpdateProjectPayload.Type
  }) {
    return yield* mapProjectErrors(projects.update({ ...ctx.payload, projectID: ctx.params.projectID }))
  })

  const reorderProjects = Effect.fn("OpencodeXHttpApi.reorderProjects")(function* (ctx: {
    payload: OpencodeXProject.ReorderInput
  }) {
    return yield* projects.reorder(ctx.payload)
  })

  const createSession = Effect.fn("OpencodeXHttpApi.createSession")(function* (ctx: {
    payload: OpencodeXProject.CreateSessionInput
  }) {
    return yield* mapProjectErrors(projects.createSession(ctx.payload))
  })

  const sessionSync = Effect.fn("OpencodeXHttpApi.sessionSync")(function* (ctx: {
    query: typeof SessionSyncQuery.Type
  }) {
    const [projectList, listed, viewList, statusMap, permissionList, questionList] = yield* Effect.all(
      [
        projects.list(),
        sessions.list({
          directory: ctx.query.scope === "project" ? undefined : ctx.query.directory,
          scope: ctx.query.scope,
          path: ctx.query.path,
          roots: ctx.query.roots,
          start: ctx.query.start,
          search: ctx.query.search,
          limit: ctx.query.limit,
        }),
        views.list(),
        statuses.list(),
        permissions.list(),
        questions.list(),
      ],
      { concurrency: "unbounded" },
    )
    const lightProjects: OpencodeXProject.Info[] = projectList.map((project) => ({
      ...project,
      sessions: project.sessions.map(stripSessionSummaryDiffs),
    }))
    const lightViews: OpencodeXView.Info[] = viewList.map((view) => ({
      ...view,
      sessions: view.sessions.map(stripSessionSummaryDiffs),
    }))
    const lightSessions = mergeSessions(listed.map(stripSessionSummaryDiffs), lightProjects)
    const sessionStatus = sessionStatusSnapshot(statusMap)
    const states = yield* sessionState.list(lightSessions.map((session) => session.id))
    const permissionsBySession = groupBySession(permissionList)
    const questionsBySession = groupBySession(questionList)
    const snapshot = {
      projects: lightProjects,
      sessions: lightSessions,
      views: lightViews,
      sessionStatus,
      permissions: permissionList.toSorted((left, right) => String(left.id).localeCompare(String(right.id))),
      questions: questionList.toSorted((left, right) => String(left.id).localeCompare(String(right.id))),
      sessionUiState: Object.fromEntries(
        lightSessions.map((session) => [
          session.id,
          OpencodeXSessionState.deriveUiState({
            session,
            status: sessionStatus[session.id],
            permissions: permissionsBySession[session.id] ?? [],
            questions: questionsBySession[session.id] ?? [],
            state: states[session.id],
          }),
        ]),
      ),
    }
    const revision = Bun.hash(JSON.stringify(snapshot)).toString(36)
    if (ctx.query.since === revision) return { changed: false as const, revision }
    return { changed: true as const, revision, snapshot }
  })

  const updateSessionState = Effect.fn("OpencodeXHttpApi.updateSessionState")(function* (ctx: {
    params: { sessionID: SessionID }
    payload: typeof UpdateSessionStatePayload.Type
  }) {
    yield* SessionError.mapStorageNotFound(sessions.get(ctx.params.sessionID))
    return yield* sessionState.update({ ...ctx.payload, sessionID: ctx.params.sessionID })
  })

  const moveSession = Effect.fn("OpencodeXHttpApi.moveSession")(function* (ctx: {
    payload: OpencodeXProject.MoveSessionInput
  }) {
    return yield* projects.moveSession(ctx.payload).pipe(
      Effect.catchTag("Project.NotFoundError", (error) =>
        Effect.fail(
          new ProjectNotFoundError({
            projectID: error.projectID,
            message: `Project not found: ${error.projectID}`,
          }),
        ),
      ),
      Effect.catchTag("NotFoundError", (error) => Effect.fail(notFound(error.message))),
    )
  })

  const removeSession = Effect.fn("OpencodeXHttpApi.removeSession")(function* (ctx: {
    params: { sessionID: SessionID }
  }) {
    yield* SessionError.mapStorageNotFound(projects.removeSession(ctx.params.sessionID))
    return true
  })

  const removeProject = Effect.fn("OpencodeXHttpApi.removeProject")(function* (ctx: {
    params: { projectID: string }
  }) {
    return yield* projects.removeProject(ctx.params.projectID)
  })

  return {
    listProjects,
    createProject,
    validateProject,
    updateProject,
    reorderProjects,
    createSession,
    sessionSync,
    updateSessionState,
    moveSession,
    removeSession,
    removeProject,
  }
})

export function sessionStatusSnapshot(active: Map<SessionID, SessionStatus.Info>) {
  return Object.fromEntries(active.entries().toArray().toSorted(([left], [right]) => left.localeCompare(right)))
}

function mapProjectErrors<A, R>(effect: Effect.Effect<A, OpencodeXProject.InvalidFolderError | Project.NotFoundError, R>) {
  return effect.pipe(
    Effect.catchTag("OpencodeX.InvalidFolderError", () => Effect.fail(new HttpApiError.BadRequest({}))),
    Effect.catchTag("Project.NotFoundError", (error) =>
      Effect.fail(
        new ProjectNotFoundError({
          projectID: error.projectID,
          message: `Project not found: ${error.projectID}`,
        }),
      ),
    ),
  )
}

function mergeSessions(sessions: readonly Session.Info[], projects: readonly OpencodeXProject.Info[]): Session.Info[] {
  return [
    ...new Map(
      [...sessions.map(asSessionInfo), ...projects.flatMap((project) => project.sessions.map(asSessionInfo))].map(
        (session): [SessionID, Session.Info] => [session.id, session],
      ),
    ).values(),
  ].sort((left, right) => right.time.updated - left.time.updated || String(right.id).localeCompare(String(left.id)))
}

function asSessionInfo(session: Session.Info | OpencodeXProject.Info["sessions"][number]): Session.Info {
  return stripSessionSummaryDiffs(session) as unknown as Session.Info
}

function stripSessionSummaryDiffs<
  T extends { summary?: { additions: number; deletions: number; files: number; diffs?: unknown } },
>(session: T): T {
  if (!session.summary?.diffs) return session
  return {
    ...session,
    summary: {
      additions: session.summary.additions,
      deletions: session.summary.deletions,
      files: session.summary.files,
    },
  } as T
}

function groupBySession<T extends { sessionID: SessionID }>(items: readonly T[]) {
  return items.reduce<Record<string, T[]>>((result, item) => {
    const group = result[item.sessionID] ?? []
    group.push(item)
    result[item.sessionID] = group
    return result
  }, {})
}
