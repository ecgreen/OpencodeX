import { Database } from "@opencode-ai/core/database/database"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ProjectV2 } from "@opencode-ai/core/project"
import { WorkspaceV2 } from "@opencode-ai/core/workspace"
import { serviceUse } from "@opencode-ai/core/effect/service-use"
import { Identifier } from "@opencode-ai/core/util/identifier"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { Context, Effect, Layer, Schema, Types } from "effect"
import { inArray } from "drizzle-orm"
import { Permission } from "@/permission"
import { Project } from "@/project/project"
import { InstanceStore } from "@/project/instance-store"
import { Session } from "@/session/session"
import { SessionID } from "@/session/schema"
import { SessionShare } from "@/share/session"
import { OpencodeXProjectFolder } from "./project-folder"

export const Folder = Schema.Struct({
  path: Schema.String,
}).annotate({ identifier: "OpencodeXProjectFolder" })
export type Folder = Types.DeepMutable<Schema.Schema.Type<typeof Folder>>

export const Info = Schema.Struct({
  id: Schema.String,
  name: Schema.optional(Schema.String),
  project: Project.Info,
  folders: Schema.Array(Folder),
  sessions: Schema.Array(Session.GlobalInfo),
}).annotate({ identifier: "OpencodeXProject" })
export type Info = Types.DeepMutable<Schema.Schema.Type<typeof Info>>

export const CreateInput = Schema.Struct({
  name: Schema.optional(Schema.String),
  directory: Schema.optional(Schema.String),
  folders: Schema.optional(Schema.Array(Schema.String)),
}).annotate({ identifier: "OpencodeXProjectCreateInput" })
export type CreateInput = Types.DeepMutable<Schema.Schema.Type<typeof CreateInput>>

export const UpdateInput = Schema.Struct({
  projectID: Schema.String,
  name: Schema.optional(Schema.String),
  folders: Schema.optional(Schema.Array(Schema.String)),
}).annotate({ identifier: "OpencodeXProjectUpdateInput" })
export type UpdateInput = Types.DeepMutable<Schema.Schema.Type<typeof UpdateInput>>

export const ReorderInput = Schema.Struct({
  projectIDs: Schema.Array(Schema.String),
}).annotate({ identifier: "OpencodeXProjectReorderInput" })
export type ReorderInput = Types.DeepMutable<Schema.Schema.Type<typeof ReorderInput>>

export const CreateSessionInput = Schema.Struct({
  projectID: Schema.String,
  directory: Schema.String,
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
}).annotate({ identifier: "OpencodeXSessionCreateInput" })
export type CreateSessionInput = Types.DeepMutable<Schema.Schema.Type<typeof CreateSessionInput>>

export const MoveSessionInput = Schema.Struct({
  projectID: Schema.String,
  sessionID: SessionID,
}).annotate({ identifier: "OpencodeXSessionMoveInput" })
export type MoveSessionInput = Types.DeepMutable<Schema.Schema.Type<typeof MoveSessionInput>>

export const ValidateInput = Schema.Struct({
  projectID: Schema.optional(Schema.String),
  folders: Schema.Array(Schema.String),
}).annotate({ identifier: "OpencodeXProjectValidateInput" })
export type ValidateInput = Types.DeepMutable<Schema.Schema.Type<typeof ValidateInput>>

export const ValidationFolder = Schema.Struct({
  input: Schema.String,
  path: Schema.String,
  valid: Schema.Boolean,
  message: Schema.optional(Schema.String),
}).annotate({ identifier: "OpencodeXProjectFolderValidation" })
export type ValidationFolder = Types.DeepMutable<Schema.Schema.Type<typeof ValidationFolder>>

export const Validation = Schema.Struct({
  valid: Schema.Boolean,
  folders: Schema.Array(ValidationFolder),
}).annotate({ identifier: "OpencodeXProjectValidation" })
export type Validation = Types.DeepMutable<Schema.Schema.Type<typeof Validation>>

export class InvalidFolderError extends Schema.TaggedErrorClass<InvalidFolderError>()(
  "OpencodeX.InvalidFolderError",
  {
    path: Schema.String,
    message: Schema.String,
  },
) {}

export interface Interface {
  readonly list: () => Effect.Effect<Info[]>
  readonly get: (projectID: string) => Effect.Effect<Info, Project.NotFoundError>
  readonly validate: (input: ValidateInput) => Effect.Effect<Validation>
  readonly create: (input: CreateInput) => Effect.Effect<Info, InvalidFolderError | Project.NotFoundError>
  readonly update: (input: UpdateInput) => Effect.Effect<Info, InvalidFolderError | Project.NotFoundError>
  readonly reorder: (input: ReorderInput) => Effect.Effect<Info[]>
  readonly createSession: (
    input: CreateSessionInput,
  ) => Effect.Effect<Session.Info, InvalidFolderError | Project.NotFoundError>
  readonly moveSession: (input: MoveSessionInput) => Effect.Effect<Session.Info, Project.NotFoundError | Session.NotFound>
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
    const { db } = yield* Database.Service

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
          message: invalid.message ?? `Invalid project folder: ${invalid.path}`,
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
          : (
              yield* db
                .select({ id: SessionTable.id })
                .from(SessionTable)
                .where(inArray(SessionTable.id, trackedSessionIDs))
                .all()
                .pipe(Effect.orDie)
            ).map((session) => session.id),
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
        sessions: (yield* sessions.listGlobal({ roots: true, limit: 5_000 })).filter(
          (session) => trackedIDs.has(session.id),
        ),
      }
    })

    const list = Effect.fn("OpencodeXProject.list")(function* () {
      return yield* Effect.forEach(yield* OpencodeXProjectFolder.listProjects(db), hydrate, {
        concurrency: "unbounded",
      })
    })

    const get = Effect.fn("OpencodeXProject.get")(function* (projectID: string) {
      const row = yield* OpencodeXProjectFolder.getProject(db, projectID)
      if (!row) return yield* new Project.NotFoundError({ projectID: ProjectV2.ID.make(projectID) })
      return yield* hydrate(row)
    })

    const create = Effect.fn("OpencodeXProject.create")(function* (input: CreateInput) {
      const folders = yield* normalizeFolders({ folders: input.folders ?? [] })
      const { project: item } = yield* project.fromDirectory(folders[0] ?? input.directory ?? process.cwd())
      const id = `opx_${Identifier.ascending()}`
      const name = input.name?.trim()
      yield* OpencodeXProjectFolder.createProject(db, { id, projectID: item.id, name: name || undefined })
      yield* OpencodeXProjectFolder.replaceFolders(db, { opencodexProjectID: id, projectID: item.id, folders })
      return yield* get(id)
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

    const update = Effect.fn("OpencodeXProject.update")(function* (input: UpdateInput) {
      const current = yield* OpencodeXProjectFolder.getProject(db, input.projectID)
      if (!current) return yield* new Project.NotFoundError({ projectID: ProjectV2.ID.make(input.projectID) })
      const folders = input.folders
        ? yield* normalizeFolders({ projectID: input.projectID, folders: input.folders })
        : undefined
      const upstream = folders && folders.length > 0
        ? (yield* project.fromDirectory(folders[0])).project
        : yield* project.get(current.project_id)
      if (!upstream) return yield* new Project.NotFoundError({ projectID: current.project_id })
      const name = input.name?.trim()
      yield* OpencodeXProjectFolder.updateProject(db, {
        id: input.projectID,
        projectID: upstream.id,
        name: name === undefined ? current.name : name || null,
      })
      if (folders) {
        yield* OpencodeXProjectFolder.replaceFolders(db, {
          opencodexProjectID: input.projectID,
          projectID: upstream.id,
          folders,
        })
      }
      return yield* get(input.projectID)
    })

    const reorder = Effect.fn("OpencodeXProject.reorder")(function* (input: ReorderInput) {
      const rows = yield* OpencodeXProjectFolder.listProjects(db)
      const knownIDs = new Set(rows.map((row) => row.id))
      const requestedIDs = [...new Set(input.projectIDs)].filter((id) => knownIDs.has(id))
      yield* OpencodeXProjectFolder.reorderProjects(db, [
        ...requestedIDs,
        ...rows.map((row) => row.id).filter((id) => !requestedIDs.includes(id)),
      ])
      return yield* list()
    })

    const createSession = Effect.fn("OpencodeXProject.createSession")(function* (input: CreateSessionInput) {
      const current = yield* OpencodeXProjectFolder.getProject(db, input.projectID)
      if (!current) return yield* new Project.NotFoundError({ projectID: ProjectV2.ID.make(input.projectID) })
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
          title: input.title,
          agent: input.agent,
          model: input.model,
          metadata: {
            ...input.metadata,
            ...(yield* metadata(input.projectID)),
          },
          permission: input.permission,
          workspaceID: input.workspaceID,
        }),
      )
      yield* OpencodeXProjectFolder.addSession(db, {
        opencodexProjectID: input.projectID,
        sessionID: result.id,
        path: directory,
      })
      return result
    })

    const moveSession = Effect.fn("OpencodeXProject.moveSession")(function* (input: MoveSessionInput) {
      const current = yield* OpencodeXProjectFolder.getProject(db, input.projectID)
      if (!current) return yield* new Project.NotFoundError({ projectID: ProjectV2.ID.make(input.projectID) })
      const session = yield* sessions.get(input.sessionID)
      yield* sessions.setMetadata({
        sessionID: session.id,
        metadata: {
          ...session.metadata,
          ...(yield* metadata(input.projectID)),
        },
      })
      yield* OpencodeXProjectFolder.addSession(db, {
        opencodexProjectID: input.projectID,
        sessionID: session.id,
        path: session.directory,
      })
      return session
    })

    const removeProject = Effect.fn("OpencodeXProject.removeProject")(function* (projectID: string) {
      yield* OpencodeXProjectFolder.removeProject(db, projectID)
      return true
    })

    const removeSession = Effect.fn("OpencodeXProject.removeSession")(function* (sessionID: SessionID) {
      yield* OpencodeXProjectFolder.removeSession(db, sessionID)
      yield* sessions.remove(sessionID).pipe(Effect.catchTag("NotFoundError", () => Effect.void))
      return true
    })

    return Service.of({
      list,
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
  Layer.provide(InstanceStore.defaultLayer),
)

export const use = serviceUse(Service)

export * as OpencodeXProject from "./project"
