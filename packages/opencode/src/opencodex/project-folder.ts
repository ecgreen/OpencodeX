import {
  OpencodeXProjectFolderTable,
  OpencodeXProjectSessionTable,
  OpencodeXProjectTable,
} from "@opencode-ai/core/opencodex/sql"
import { Database } from "@opencode-ai/core/database/database"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { ProjectV2 } from "@opencode-ai/core/project"
import { SessionID } from "@/session/schema"
import { and, eq, inArray } from "drizzle-orm"
import { Effect } from "effect"
import path from "path"

type DatabaseService = Database.Interface["db"]
type FolderRow = typeof OpencodeXProjectFolderTable.$inferSelect
export type ProjectRow = typeof OpencodeXProjectTable.$inferSelect

export function normalizeFolderPath(input: string) {
  return path.resolve(input)
}

export function containsFolder(folder: string, target: string) {
  return AppFileSystem.contains(normalizeFolderPath(folder), normalizeFolderPath(target))
}

export function matchFolder(rows: FolderRow[], directory: string) {
  return rows
    .filter((row) => containsFolder(row.path, directory))
    .toSorted((a, b) => b.path.length - a.path.length)[0]
}

export function findFolder(db: DatabaseService, directory: string) {
  return db
    .select()
    .from(OpencodeXProjectFolderTable)
    .all()
    .pipe(
      Effect.orDie,
      Effect.map((rows) => matchFolder(rows, directory)),
    )
}

export function listProjects(db: DatabaseService) {
  return db
    .select()
    .from(OpencodeXProjectTable)
    .orderBy(OpencodeXProjectTable.sort_order, OpencodeXProjectTable.time_created)
    .all()
    .pipe(Effect.orDie)
}

export function getProject(db: DatabaseService, opencodexProjectID: string) {
  return db
    .select()
    .from(OpencodeXProjectTable)
    .where(eq(OpencodeXProjectTable.id, opencodexProjectID))
    .get()
    .pipe(Effect.orDie)
}

export function createProject(db: DatabaseService, input: { id: string; projectID: ProjectV2.ID; name?: string }) {
  const now = Date.now()
  return db
    .insert(OpencodeXProjectTable)
    .values({
      id: input.id,
      project_id: input.projectID,
      name: input.name,
      sort_order: now,
      time_created: now,
      time_updated: now,
    })
    .run()
    .pipe(Effect.orDie)
}

export function reorderProjects(db: DatabaseService, projectIDs: readonly string[]) {
  return db
    .transaction(
      (tx) =>
        Effect.forEach(
          projectIDs,
          (id, index) =>
            tx
              .update(OpencodeXProjectTable)
              .set({ sort_order: index, time_updated: Date.now() })
              .where(eq(OpencodeXProjectTable.id, id))
              .run(),
          { discard: true },
        ),
      { behavior: "immediate" },
    )
    .pipe(Effect.orDie)
}

export function updateProject(
  db: DatabaseService,
  input: { id: string; projectID?: ProjectV2.ID; name?: string | null },
) {
  return db
    .update(OpencodeXProjectTable)
    .set({
      project_id: input.projectID,
      name: input.name,
      time_updated: Date.now(),
    })
    .where(eq(OpencodeXProjectTable.id, input.id))
    .returning()
    .get()
    .pipe(Effect.orDie)
}

export function listFolders(db: DatabaseService, opencodexProjectID: string) {
  return db
    .select()
    .from(OpencodeXProjectFolderTable)
    .where(eq(OpencodeXProjectFolderTable.opencodex_project_id, opencodexProjectID))
    .orderBy(OpencodeXProjectFolderTable.path)
    .all()
    .pipe(Effect.orDie)
}

export function listFoldersForOpencodeProjects(db: DatabaseService, projectIDs: ProjectV2.ID[]) {
  if (projectIDs.length === 0) return Effect.succeed([] as FolderRow[])
  return db
    .select()
    .from(OpencodeXProjectFolderTable)
    .where(inArray(OpencodeXProjectFolderTable.project_id, projectIDs))
    .orderBy(OpencodeXProjectFolderTable.project_id, OpencodeXProjectFolderTable.path)
    .all()
    .pipe(Effect.orDie)
}

export function replaceFolders(
  db: DatabaseService,
  input: { opencodexProjectID: string; projectID: ProjectV2.ID; folders: readonly string[] },
) {
  const now = Date.now()
  const paths = [...new Set(input.folders.map(normalizeFolderPath))]
  return db
    .transaction(
      (tx) =>
        Effect.gen(function* () {
          yield* tx
            .delete(OpencodeXProjectFolderTable)
            .where(eq(OpencodeXProjectFolderTable.opencodex_project_id, input.opencodexProjectID))
            .run()
          if (paths.length === 0) return
          yield* tx
    .insert(OpencodeXProjectFolderTable)
            .values(
              paths.map((item) => ({
                path: item,
                opencodex_project_id: input.opencodexProjectID,
                project_id: input.projectID,
                time_created: now,
                time_updated: now,
              })),
            )
    .onConflictDoUpdate({
      target: [OpencodeXProjectFolderTable.opencodex_project_id, OpencodeXProjectFolderTable.path],
      set: {
                opencodex_project_id: input.opencodexProjectID,
                project_id: input.projectID,
                time_updated: now,
              },
            })
            .run()
        }),
      { behavior: "immediate" },
    )
    .pipe(Effect.orDie)
}

export function removeFolder(db: DatabaseService, opencodexProjectID: string, folder: string) {
  return db
    .delete(OpencodeXProjectFolderTable)
    .where(
      and(
        eq(OpencodeXProjectFolderTable.opencodex_project_id, opencodexProjectID),
        eq(OpencodeXProjectFolderTable.path, normalizeFolderPath(folder)),
      ),
    )
    .run()
    .pipe(Effect.orDie)
}

export function addSession(
  db: DatabaseService,
  input: { opencodexProjectID: string; sessionID: SessionID; path: string },
) {
  const now = Date.now()
  return db
    .insert(OpencodeXProjectSessionTable)
    .values({
      session_id: input.sessionID,
      opencodex_project_id: input.opencodexProjectID,
      path: normalizeFolderPath(input.path),
      time_created: now,
      time_updated: now,
    })
    .onConflictDoUpdate({
      target: OpencodeXProjectSessionTable.session_id,
      set: {
        opencodex_project_id: input.opencodexProjectID,
        path: normalizeFolderPath(input.path),
        time_updated: now,
      },
    })
    .run()
    .pipe(Effect.orDie)
}

export function listSessionIDs(db: DatabaseService, opencodexProjectID: string) {
  return db
    .select()
    .from(OpencodeXProjectSessionTable)
    .where(eq(OpencodeXProjectSessionTable.opencodex_project_id, opencodexProjectID))
    .all()
    .pipe(Effect.orDie)
}

export function getSessionProject(db: DatabaseService, sessionID: SessionID) {
  return db
    .select()
    .from(OpencodeXProjectSessionTable)
    .where(eq(OpencodeXProjectSessionTable.session_id, sessionID))
    .get()
    .pipe(Effect.orDie)
}

export function listAllSessionIDs(db: DatabaseService) {
  return db.select().from(OpencodeXProjectSessionTable).all().pipe(Effect.orDie)
}

export function removeSession(db: DatabaseService, sessionID: SessionID) {
  return db
    .delete(OpencodeXProjectSessionTable)
    .where(eq(OpencodeXProjectSessionTable.session_id, sessionID))
    .run()
    .pipe(Effect.orDie)
}

export function removeProject(db: DatabaseService, opencodexProjectID: string) {
  return db
    .delete(OpencodeXProjectTable)
    .where(eq(OpencodeXProjectTable.id, opencodexProjectID))
    .run()
    .pipe(Effect.orDie)
}

export * as OpencodeXProjectFolder from "./project-folder"
