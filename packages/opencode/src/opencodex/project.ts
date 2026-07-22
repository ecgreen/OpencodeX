import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ProjectV2 } from "@opencode-ai/core/project"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionLegacy } from "@opencode-ai/core/session/legacy"
import { WorkspaceV2 } from "@opencode-ai/core/workspace"
import { serviceUse } from "@opencode-ai/core/effect/service-use"
import { Identifier } from "@opencode-ai/core/util/identifier"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { Context, Effect, Layer, Option, Schema, Semaphore, Struct } from "effect"
import { inArray } from "drizzle-orm"
import { Permission } from "@/permission"
import { EventV2Bridge } from "@/event-v2-bridge"
import { InstanceBootstrap } from "@/project/bootstrap"
import { Project } from "@/project/project"
import { InstanceStore } from "@/project/instance-store"
import { Session } from "@/session/session"
import { SessionID } from "@/session/schema"
import { SessionShare } from "@/share/session"
import { OpencodeXProjectFolder } from "./project-folder"

export const Folder = Schema.Struct({
  path: Schema.String,
}).annotate({ identifier: "OpencodeXProjectFolder" })
export type Folder = Schema.Schema.Type<typeof Folder>

export const Info = Schema.Struct({
  id: Schema.String,
  name: Schema.optional(Schema.String),
  project: Project.Info,
  folders: Schema.Array(Folder),
  sessions: Schema.Array(Session.GlobalInfo),
}).annotate({ identifier: "OpencodeXProject" })
export type Info = Schema.Schema.Type<typeof Info>

export const CatalogInfo = Schema.Struct({
  ...Struct.omit(Info.fields, ["sessions"]),
  sessionIDs: Schema.Array(SessionID),
}).annotate({ identifier: "OpencodeXCatalogProject" })
export type CatalogInfo = Schema.Schema.Type<typeof CatalogInfo>

export const CreateInput = Schema.Struct({
  name: Schema.optional(Schema.String),
  directory: Schema.optional(Schema.String),
  folders: Schema.optional(Schema.Array(Schema.String)),
}).annotate({ identifier: "OpencodeXProjectCreateInput" })
export type CreateInput = Schema.Schema.Type<typeof CreateInput>

export const UpdateInput = Schema.Struct({
  projectID: Schema.String,
  name: Schema.optional(Schema.String),
  folders: Schema.optional(Schema.Array(Schema.String)),
}).annotate({ identifier: "OpencodeXProjectUpdateInput" })
export type UpdateInput = Schema.Schema.Type<typeof UpdateInput>

export const ReorderInput = Schema.Struct({
  projectIDs: Schema.Array(Schema.String),
}).annotate({ identifier: "OpencodeXProjectReorderInput" })
export type ReorderInput = Schema.Schema.Type<typeof ReorderInput>

export const Event = {
  Created: EventV2.define({
    type: "opencodex.project.created",
    sync: { aggregate: "projectID", version: 1 },
    schema: { projectID: Schema.String },
  }),
  Updated: EventV2.define({
    type: "opencodex.project.updated",
    sync: { aggregate: "projectID", version: 1 },
    schema: { projectID: Schema.String },
  }),
  Reordered: EventV2.define({
    type: "opencodex.project.reordered",
    sync: { aggregate: "collectionID", version: 1 },
    schema: { collectionID: Schema.String },
  }),
  Deleted: EventV2.define({
    type: "opencodex.project.deleted",
    sync: { aggregate: "projectID", version: 1 },
    schema: { projectID: Schema.String },
  }),
  SessionAssigned: EventV2.define({
    type: "opencodex.project.session_assigned",
    sync: { aggregate: "projectID", version: 1 },
    schema: { projectID: Schema.String, sessionID: SessionID },
  }),
}

export const CreateSessionInput = Schema.Struct({
  projectID: Schema.String,
  directory: Schema.String,
  sessionID: Schema.optional(SessionID),
  title: Schema.optional(Schema.String),
  agent: Schema.optional(Schema.String),
  model: Schema.optional(
    Schema.Struct({
      id: ProviderV2.ModelID,
      providerID: ProviderV2.ID,
      variant: Schema.optional(Schema.String),
    }),
  ),
  metadata: Schema.optional(Session.Metadata),
  permission: Schema.optional(Permission.Ruleset),
  workspaceID: Schema.optional(WorkspaceV2.ID),
  hidden: Schema.optional(Schema.Boolean),
}).annotate({ identifier: "OpencodeXSessionCreateInput" })
export type CreateSessionInput = Schema.Schema.Type<typeof CreateSessionInput>

export const MoveSessionInput = Schema.Struct({
  projectID: Schema.String,
  sessionID: SessionID,
}).annotate({ identifier: "OpencodeXSessionMoveInput" })
export type MoveSessionInput = Schema.Schema.Type<typeof MoveSessionInput>

export const ValidateInput = Schema.Struct({
  projectID: Schema.optional(Schema.String),
  folders: Schema.Array(Schema.String),
}).annotate({ identifier: "OpencodeXProjectValidateInput" })
export type ValidateInput = Schema.Schema.Type<typeof ValidateInput>

export const ValidationFolder = Schema.Struct({
  input: Schema.String,
  path: Schema.String,
  valid: Schema.Boolean,
  message: Schema.optional(Schema.String),
}).annotate({ identifier: "OpencodeXProjectFolderValidation" })
export type ValidationFolder = Schema.Schema.Type<typeof ValidationFolder>

export const Validation = Schema.Struct({
  valid: Schema.Boolean,
  folders: Schema.Array(ValidationFolder),
}).annotate({ identifier: "OpencodeXProjectValidation" })
export type Validation = Schema.Schema.Type<typeof Validation>

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null
}

function mergeMetadata(input: { session?: Record<string, unknown>; project: Record<string, unknown> }) {
  return {
    ...input.session,
    ...input.project,
    opencodex: {
      ...(isRecord(input.session?.opencodex) ? input.session.opencodex : {}),
      ...(isRecord(input.project.opencodex) ? input.project.opencodex : {}),
    },
  }
}

export class InvalidFolderError extends Schema.TaggedErrorClass<InvalidFolderError>()("OpencodeX.InvalidFolderError", {
  path: Schema.String,
  message: Schema.String,
}) {}

export interface Interface {
  readonly list: (input?: { sessions?: Session.GlobalInfo[] }) => Effect.Effect<Info[]>
  readonly listCatalog: () => Effect.Effect<CatalogInfo[]>
  readonly get: (projectID: string) => Effect.Effect<Info, Project.NotFoundError>
  readonly validate: (input: ValidateInput) => Effect.Effect<Validation>
  readonly create: (input: CreateInput) => Effect.Effect<Info, InvalidFolderError | Project.NotFoundError>
  readonly update: (input: UpdateInput) => Effect.Effect<Info, InvalidFolderError | Project.NotFoundError>
  readonly reorder: (input: ReorderInput) => Effect.Effect<Info[]>
  readonly createSession: (
    input: CreateSessionInput,
  ) => Effect.Effect<Session.Info, InvalidFolderError | Project.NotFoundError>
  readonly moveSession: (
    input: MoveSessionInput,
  ) => Effect.Effect<Session.Info, Project.NotFoundError | Session.NotFound>
  readonly removeProject: (projectID: string) => Effect.Effect<boolean>
  readonly removeSession: (sessionID: SessionID) => Effect.Effect<boolean, Session.NotFound>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/OpencodeXProject") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    const project = yield* Project.Service
    const sessions = yield* Session.Service
    const share = yield* SessionShare.Service
    const store = yield* InstanceStore.Service
    const events = yield* EventV2Bridge.Service
    const { db } = yield* Database.Service
    const mutationLock = Semaphore.makeUnsafe(1)

    const validate = Effect.fn("OpencodeXProject.validate")(function* (input: ValidateInput) {
      const folders = yield* Effect.forEach(
        input.folders
          .map((folder) => folder.trim())
          .filter(Boolean)
          .map((folder) => ({ input: folder, path: OpencodeXProjectFolder.normalizeFolderPath(folder) })),
        (folder) =>
          fs.isDir(folder.path).pipe(
            Effect.orDie,
            Effect.map((valid) => {
              if (!valid) {
                return {
                  ...folder,
                  valid: false,
                  message: `Not a directory: ${folder.path}`,
                }
              }
              return {
                ...folder,
                valid: true,
              }
            }),
          ),
        { concurrency: "unbounded" },
      )
      return {
        valid: folders.every((folder) => folder.valid),
        folders,
      }
    })

    const normalizeFolders = Effect.fn("OpencodeXProject.normalizeFolders")(function* (input: ValidateInput) {
      const paths = [
        ...new Set(
          input.folders
            .map((folder) => folder.trim())
            .filter(Boolean)
            .map(OpencodeXProjectFolder.normalizeFolderPath),
        ),
      ]
      const invalid = (yield* validate({ ...input, folders: paths })).folders.find((folder) => !folder.valid)
      if (invalid) {
        return yield* new InvalidFolderError({
          path: invalid.path,
          message: "message" in invalid ? invalid.message : `Invalid project folder: ${invalid.path}`,
        })
      }
      return paths
    })

    const hydrate = Effect.fn("OpencodeXProject.hydrate")(function* (row: OpencodeXProjectFolder.ProjectRow) {
      const item = yield* project.get(row.project_id)
      if (!item) return yield* new Project.NotFoundError({ projectID: row.project_id })
      const folders = yield* OpencodeXProjectFolder.listFolders(db, row.id)
      const tracked = yield* OpencodeXProjectFolder.listSessionIDs(db, row.id)
      const trackedSessionIDs = tracked.map((session) => session.session_id)
      const existingIDs = new Set(
        trackedSessionIDs.length === 0
          ? []
          : (yield* db
              .select({ id: SessionTable.id })
              .from(SessionTable)
              .where(inArray(SessionTable.id, trackedSessionIDs))
              .all()
              .pipe(Effect.orDie)).map((session) => session.id),
      )
      yield* Effect.forEach(
        tracked.filter((session) => !existingIDs.has(session.session_id)),
        (missing) => OpencodeXProjectFolder.removeSession(db, missing.session_id),
        { concurrency: "unbounded", discard: true },
      )
      const trackedIDs = new Set(
        tracked.filter((session) => existingIDs.has(session.session_id)).map((session) => session.session_id),
      )
      return {
        id: row.id,
        name: row.name ?? undefined,
        project: item,
        folders: folders.map((folder) => ({ path: folder.path })),
        sessions: (yield* sessions.listGlobalByIDs([...trackedIDs])).filter((session) => !session.parentID),
      }
    })

    const list = Effect.fn("OpencodeXProject.list")(function* (input?: { sessions?: Session.GlobalInfo[] }) {
      const rows = yield* OpencodeXProjectFolder.listProjects(db)
      if (rows.length === 0) return []
      const [upstream, folders, tracked] = yield* Effect.all(
        [
          project.list(),
          OpencodeXProjectFolder.listFoldersForOpencodeProjects(db, [
            ...new Set(rows.map((row) => ProjectV2.ID.make(row.project_id))),
          ]),
          OpencodeXProjectFolder.listAllSessionIDs(db),
        ],
        { concurrency: "unbounded" },
      )
      const globalSessions = input?.sessions ?? (yield* sessions.listGlobalByIDs(tracked.map((item) => item.session_id)))
      const upstreamByID = new Map(upstream.map((item) => [item.id, item]))
      const sessionByID = new Map(globalSessions.map((item) => [item.id, item]))
      const existingIDs = new Set(
        tracked.length === 0
          ? []
          : (yield* db
              .select({ id: SessionTable.id })
              .from(SessionTable)
              .where(
                inArray(
                  SessionTable.id,
                  tracked.map((item) => item.session_id),
                ),
              )
              .all()
              .pipe(Effect.orDie)).map((item) => item.id),
      )
      const missingIDs = tracked.filter((item) => !existingIDs.has(item.session_id)).map((item) => item.session_id)
      if (missingIDs.length > 0) {
        yield* Effect.forEach(missingIDs, (sessionID) => OpencodeXProjectFolder.removeSession(db, sessionID), {
          concurrency: "unbounded",
          discard: true,
        })
      }
      const foldersByProject = Map.groupBy(folders, (folder) => folder.opencodex_project_id)
      const sessionsByProject = Map.groupBy(
        tracked.filter((item) => existingIDs.has(item.session_id)),
        (item) => item.opencodex_project_id,
      )
      return rows.flatMap((row) => {
        const item = upstreamByID.get(row.project_id)
        if (!item) return []
        return [
          {
            id: row.id,
            name: row.name ?? undefined,
            project: item,
            folders: (foldersByProject.get(row.id) ?? []).map((folder) => ({ path: folder.path })),
            sessions: (sessionsByProject.get(row.id) ?? []).flatMap((entry) => sessionByID.get(entry.session_id) ?? []),
          },
        ]
      })
    })

    const listCatalog = Effect.fn("OpencodeXProject.listCatalog")(function* () {
      const rows = yield* OpencodeXProjectFolder.listProjects(db)
      if (rows.length === 0) return []
      const [upstream, folders, tracked] = yield* Effect.all(
        [
          project.list(),
          OpencodeXProjectFolder.listFoldersForOpencodeProjects(db, [
            ...new Set(rows.map((row) => ProjectV2.ID.make(row.project_id))),
          ]),
          OpencodeXProjectFolder.listAllSessionIDs(db),
        ],
        { concurrency: "unbounded" },
      )
      const upstreamByID = new Map(upstream.map((item) => [item.id, item]))
      const foldersByProject = Map.groupBy(folders, (folder) => folder.opencodex_project_id)
      const sessionsByProject = Map.groupBy(tracked, (item) => item.opencodex_project_id)
      return rows.flatMap((row) => {
        const item = upstreamByID.get(row.project_id)
        if (!item) return []
        return [
          {
            id: row.id,
            name: row.name ?? undefined,
            project: item,
            folders: (foldersByProject.get(row.id) ?? []).map((folder) => ({ path: folder.path })),
            sessionIDs: (sessionsByProject.get(row.id) ?? []).map((entry) => entry.session_id),
          },
        ]
      })
    })

    const get = Effect.fn("OpencodeXProject.get")(function* (projectID: string) {
      const row = yield* OpencodeXProjectFolder.getProject(db, projectID)
      if (!row) return yield* new Project.NotFoundError({ projectID: ProjectV2.ID.make(projectID) })
      return yield* hydrate(row)
    })

    const createUnlocked = Effect.fnUntraced(function* (input: CreateInput) {
      const folders = yield* normalizeFolders({ folders: input.folders ?? [] })
      const { project: item } = yield* project.fromDirectory(folders[0] ?? input.directory ?? process.cwd())
      const id = `opx_${Identifier.ascending()}`
      const name = input.name?.trim()
      const event = yield* events.barrier(
        db.transaction(
          (transaction) =>
            Effect.gen(function* () {
              yield* OpencodeXProjectFolder.createProject(transaction, {
                id,
                projectID: item.id,
                name: name || undefined,
              })
              yield* OpencodeXProjectFolder.replaceFolders(transaction, {
                opencodexProjectID: id,
                projectID: item.id,
                folders,
              })
              return yield* events.commit(Event.Created, { projectID: id })
            }),
          { behavior: "immediate" },
        ).pipe(Effect.catchTag("SqlError", Effect.die)),
      )
      const result = yield* get(id)
      yield* events.broadcast(event)
      return result
    })

    const create = Effect.fn("OpencodeXProject.create")(function* (input: CreateInput) {
      return yield* mutationLock.withPermits(1)(createUnlocked(input))
    })

    const metadata = Effect.fn("OpencodeXProject.metadata")(function* (projectID: string) {
      const current = yield* OpencodeXProjectFolder.getProject(db, projectID)
      if (!current) return yield* new Project.NotFoundError({ projectID: ProjectV2.ID.make(projectID) })
      const folders = yield* OpencodeXProjectFolder.listFolders(db, projectID)
      return {
        opencodex: {
          projectID,
          ...(current.name ? { name: current.name } : {}),
          folders: folders.map((folder) => folder.path),
        },
      }
    })

    const updateUnlocked = Effect.fnUntraced(function* (input: UpdateInput) {
      const folders = input.folders
        ? yield* normalizeFolders({ projectID: input.projectID, folders: input.folders })
        : undefined
      const folderProject = folders && folders.length > 0 ? (yield* project.fromDirectory(folders[0])).project : undefined
      const name = input.name?.trim()
      const event = yield* events.barrier(
        db.transaction(
          (transaction) =>
            Effect.gen(function* () {
              const current = yield* OpencodeXProjectFolder.getProject(transaction, input.projectID)
              if (!current) {
                return yield* new Project.NotFoundError({ projectID: ProjectV2.ID.make(input.projectID) })
              }
              const upstream = folderProject ?? (yield* project.get(current.project_id))
              if (!upstream) return yield* new Project.NotFoundError({ projectID: current.project_id })
              yield* OpencodeXProjectFolder.updateProject(transaction, {
                id: input.projectID,
                projectID: upstream.id,
                name: name === undefined ? current.name : name || null,
              })
              if (folders) {
                yield* OpencodeXProjectFolder.replaceFolders(transaction, {
                  opencodexProjectID: input.projectID,
                  projectID: upstream.id,
                  folders,
                })
              }
              return yield* events.commit(Event.Updated, { projectID: input.projectID })
            }),
          { behavior: "immediate" },
        ).pipe(Effect.catchTag("SqlError", Effect.die)),
      )
      const result = yield* get(input.projectID)
      yield* events.broadcast(event)
      return result
    })

    const update = Effect.fn("OpencodeXProject.update")(function* (input: UpdateInput) {
      return yield* mutationLock.withPermits(1)(updateUnlocked(input))
    })

    const reorderUnlocked = Effect.fnUntraced(function* (input: ReorderInput) {
      const event = yield* events.barrier(
        db.transaction(
          (transaction) =>
            Effect.gen(function* () {
              const rows = yield* OpencodeXProjectFolder.listProjects(transaction)
              const knownIDs = new Set(rows.map((row) => row.id))
              const requestedIDs = [...new Set(input.projectIDs)].filter((id) => knownIDs.has(id))
              yield* OpencodeXProjectFolder.reorderProjects(transaction, [
                ...requestedIDs,
                ...rows.map((row) => row.id).filter((id) => !requestedIDs.includes(id)),
              ])
              return yield* events.commit(Event.Reordered, { collectionID: "opencodex.projects" })
            }),
          { behavior: "immediate" },
        ).pipe(Effect.catchTag("SqlError", Effect.die)),
      )
      const result = yield* list()
      yield* events.broadcast(event)
      return result
    })

    const reorder = Effect.fn("OpencodeXProject.reorder")(function* (input: ReorderInput) {
      return yield* mutationLock.withPermits(1)(reorderUnlocked(input))
    })

    const createSessionUnlocked = Effect.fnUntraced(function* (input: CreateSessionInput) {
      const current = yield* OpencodeXProjectFolder.getProject(db, input.projectID)
      if (!current) return yield* new Project.NotFoundError({ projectID: ProjectV2.ID.make(input.projectID) })
      if (input.sessionID) {
        const existing = yield* sessions.get(input.sessionID).pipe(Effect.option)
        if (Option.isSome(existing)) {
          if (!input.hidden) {
            const event = yield* events.barrier(
              db.transaction(
                (transaction) =>
                  Effect.gen(function* () {
                    yield* OpencodeXProjectFolder.addSession(transaction, {
                      opencodexProjectID: input.projectID,
                      sessionID: existing.value.id,
                      path: existing.value.directory,
                    })
                    return yield* events.commit(Event.SessionAssigned, {
                      projectID: input.projectID,
                      sessionID: existing.value.id,
                    })
                  }),
                { behavior: "immediate" },
              ).pipe(Effect.catchTag("SqlError", Effect.die)),
            )
            yield* events.broadcast(event)
          }
          return existing.value
        }
      }
      const directory = OpencodeXProjectFolder.normalizeFolderPath(input.directory)
      if (!(yield* fs.isDir(directory).pipe(Effect.orDie))) {
        return yield* new InvalidFolderError({
          path: directory,
          message: `Session directory is not a directory: ${directory}`,
        })
      }
      const result = yield* store.provide(
        { directory },
        share.create({
          id: input.sessionID,
          title: input.title,
          agent: input.agent,
          model: input.model,
          metadata: mergeMetadata({ session: input.metadata, project: yield* metadata(input.projectID) }),
          permission: input.permission?.map((rule) => ({ ...rule })),
          workspaceID: input.workspaceID,
        }),
      )
      if (!input.hidden) {
        const event = yield* events.barrier(
          db.transaction(
            (transaction) =>
              Effect.gen(function* () {
                yield* OpencodeXProjectFolder.addSession(transaction, {
                  opencodexProjectID: input.projectID,
                  sessionID: result.id,
                  path: directory,
                })
                return yield* events.commit(Event.SessionAssigned, { projectID: input.projectID, sessionID: result.id })
              }),
            { behavior: "immediate" },
          ).pipe(Effect.catchTag("SqlError", Effect.die)),
        )
        yield* events.broadcast(event)
      }
      return result
    })

    const createSession = Effect.fn("OpencodeXProject.createSession")(function* (input: CreateSessionInput) {
      return yield* mutationLock.withPermits(1)(createSessionUnlocked(input))
    })

    const moveSessionUnlocked = Effect.fnUntraced(function* (input: MoveSessionInput) {
      const result = yield* events.barrier(
        db.transaction(
          (transaction) =>
            Effect.gen(function* () {
              const current = yield* OpencodeXProjectFolder.getProject(transaction, input.projectID)
              if (!current) {
                return yield* new Project.NotFoundError({ projectID: ProjectV2.ID.make(input.projectID) })
              }
              const session = yield* sessions.get(input.sessionID)
              const folders = yield* OpencodeXProjectFolder.listFolders(transaction, input.projectID)
              const next = {
                ...session,
                metadata: mergeMetadata({
                  session: session.metadata,
                  project: {
                    opencodex: {
                      projectID: input.projectID,
                      ...(current.name ? { name: current.name } : {}),
                      folders: folders.map((folder) => folder.path),
                    },
                  },
                }),
                time: { ...session.time, updated: Date.now() },
              }
              yield* OpencodeXProjectFolder.addSession(transaction, {
                opencodexProjectID: input.projectID,
                sessionID: session.id,
                path: session.directory,
              })
              const sessionEvent = yield* events.commit(
                SessionLegacy.Event.Updated,
                { sessionID: session.id, info: next },
                {
                  location: {
                    directory: AbsolutePath.make(next.directory),
                    ...(next.workspaceID ? { workspaceID: next.workspaceID } : {}),
                  },
                },
              )
              const assignmentEvent = yield* events.commit(Event.SessionAssigned, {
                projectID: input.projectID,
                sessionID: session.id,
              })
              return { next, sessionEvent, assignmentEvent }
            }),
          { behavior: "immediate" },
        ).pipe(Effect.catchTag("SqlError", Effect.die)),
      )
      yield* events.broadcast(result.sessionEvent)
      yield* events.broadcast(result.assignmentEvent)
      return result.next
    })

    const moveSession = Effect.fn("OpencodeXProject.moveSession")(function* (input: MoveSessionInput) {
      return yield* mutationLock.withPermits(1)(moveSessionUnlocked(input))
    })

    const removeProjectUnlocked = Effect.fnUntraced(function* (projectID: string) {
      const event = yield* events.barrier(
        db.transaction(
          (transaction) =>
            Effect.gen(function* () {
              yield* OpencodeXProjectFolder.removeProject(transaction, projectID)
              return yield* events.commit(Event.Deleted, { projectID })
            }),
          { behavior: "immediate" },
        ).pipe(Effect.catchTag("SqlError", Effect.die)),
      )
      yield* events.broadcast(event)
      return true
    })

    const removeProject = Effect.fn("OpencodeXProject.removeProject")(function* (projectID: string) {
      return yield* mutationLock.withPermits(1)(removeProjectUnlocked(projectID))
    })

    const removeSessionUnlocked = Effect.fnUntraced(function* (sessionID: SessionID) {
      yield* sessions.remove(sessionID).pipe(Effect.catchTag("NotFoundError", () => Effect.void))
      return true
    })

    const removeSession = Effect.fn("OpencodeXProject.removeSession")(function* (sessionID: SessionID) {
      return yield* mutationLock.withPermits(1)(removeSessionUnlocked(sessionID))
    })

    return Service.of({
      list,
      listCatalog,
      get,
      validate,
      create,
      update,
      reorder,
      createSession,
      moveSession,
      removeProject,
      removeSession,
    })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(AppFileSystem.defaultLayer),
  Layer.provide(Database.defaultLayer),
  Layer.provide(Project.defaultLayer),
  Layer.provide(Session.defaultLayer),
  Layer.provide(SessionShare.defaultLayer),
  Layer.provide(EventV2Bridge.defaultLayer),
  Layer.provide(InstanceStore.defaultLayer.pipe(Layer.provide(InstanceBootstrap.defaultLayer))),
)

export const use = serviceUse(Service)

export * as OpencodeXProject from "./project"
