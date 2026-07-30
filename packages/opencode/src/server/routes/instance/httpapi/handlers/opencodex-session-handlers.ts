import { OpencodeXProject } from "@/opencodex/project"
import { OpencodeXSessionState } from "@/opencodex/session-state"
import { OpencodeXTerminalSession } from "@/opencodex/terminal-session"
import { OpencodeXView } from "@/opencodex/view"
import { Permission } from "@/permission"
import { Project } from "@/project/project"
import { Question } from "@/question"
import { SessionID } from "@/session/schema"
import { Session } from "@/session/session"
import { SessionStatus } from "@/session/status"
import { Effect } from "effect"
import { HttpApiError } from "effect/unstable/httpapi"
import { ConflictError, notFound, ProjectNotFoundError } from "../errors"
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
  const terminalSessions = yield* OpencodeXTerminalSession.Service
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

  const updateSessionState = Effect.fn("OpencodeXHttpApi.updateSessionState")(function* (ctx: {
    params: { sessionID: SessionID }
    payload: typeof UpdateSessionStatePayload.Type
  }) {
    yield* SessionError.mapStorageNotFound(sessions.get(ctx.params.sessionID))
    return yield* sessionState.update({ ...ctx.payload, sessionID: ctx.params.sessionID }).pipe(
      Effect.catchTag("OpencodeX.SessionState.ConflictError", (error) =>
        Effect.fail(
          new ConflictError({
            message: "The session review state changed before this update was applied.",
            resource: error.sessionID,
          }),
        ),
      ),
    )
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
