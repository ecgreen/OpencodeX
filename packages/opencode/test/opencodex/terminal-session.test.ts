import { afterEach, describe, expect } from "bun:test"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Database } from "@opencode-ai/core/database/database"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Effect, Layer } from "effect"
import { EventV2Bridge } from "@/event-v2-bridge"
import { OpencodeXProject } from "@/opencodex/project"
import { OpencodeXTerminalSession } from "@/opencodex/terminal-session"
import { OpencodeXView } from "@/opencodex/view"
import { Project } from "@/project/project"
import { Session } from "@/session/session"
import { resetDatabase } from "../fixture/db"
import { testInstanceStoreLayer, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const dependencies = Layer.mergeAll(
  AppFileSystem.defaultLayer,
  CrossSpawnSpawner.defaultLayer,
  Database.defaultLayer,
  EventV2Bridge.defaultLayer,
  Project.defaultLayer,
  Session.defaultLayer,
  testInstanceStoreLayer,
)
const projects = OpencodeXProject.layer.pipe(Layer.provideMerge(dependencies))
const terminals = OpencodeXTerminalSession.layer.pipe(Layer.provideMerge(dependencies))
const services = Layer.mergeAll(projects, terminals)
const it = testEffect(OpencodeXView.layer.pipe(Layer.provideMerge(services)))

afterEach(resetDatabase)

describe("OpencodeXTerminalSession", () => {
  it.live("creates, updates, opens, reassigns, and removes catalog records", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped({ git: true })
      const projectService = yield* OpencodeXProject.Service
      const terminalService = yield* OpencodeXTerminalSession.Service
      const left = yield* projectService.create({ name: "left", folders: [directory] })
      const right = yield* projectService.create({ name: "right", folders: [directory] })
      const installationID = crypto.randomUUID()
      const created = yield* terminalService.create({
        title: "Claude investigation",
        projectID: left.id,
        directory,
        installationID,
      })

      expect(created.id).toMatch(/^oxts_/)
      expect(created.driver).toBe("claude-code")
      expect(created.resumeID).toMatch(/^[0-9a-f-]{36}$/)
      expect(created.timeLaunched).toBeUndefined()

      const updated = yield* terminalService.update({
        id: created.id,
        expectedTimeUpdated: created.timeUpdated,
        title: "Renamed",
        projectID: right.id,
      })
      expect(updated.title).toBe("Renamed")
      expect(updated.projectID).toBe(right.id)
      expect(updated.directory).toBe(directory)
      expect(updated.resumeID).toBe(created.resumeID)
      expect(updated.installationID).toBe(installationID)

      const conflict = yield* Effect.flip(terminalService.update({
        id: created.id,
        expectedTimeUpdated: created.timeUpdated,
        title: "stale",
      }))
      expect(conflict._tag).toBe("OpencodeX.TerminalSession.ConflictError")

      const opened = yield* terminalService.opened(created.id)
      const reopened = yield* terminalService.opened(created.id)
      expect(opened.timeLaunched).toBeDefined()
      expect(reopened.timeLaunched).toBe(opened.timeLaunched)
      expect(Number(reopened.timeOpened)).toBeGreaterThan(Number(opened.timeOpened))

      yield* projectService.removeProject(right.id)
      expect((yield* terminalService.get(created.id)).projectID).toBeUndefined()
      expect(yield* terminalService.remove(created.id)).toBe(true)
      expect((yield* terminalService.list()).map((item) => item.id)).not.toContain(created.id)
    }),
  )

  it.live("validates installation ownership metadata", () =>
    Effect.gen(function* () {
      const terminalService = yield* OpencodeXTerminalSession.Service
      const invalid = yield* Effect.flip(terminalService.create({
        directory: "C:\\workspace",
        installationID: "not-a-uuid",
      }))
      expect(invalid.message).toContain("installation UUID")
    }),
  )
})

describe("mixed OpencodeX views", () => {
  it.live("preserves global ordering, focus compatibility, and terminal members during legacy updates", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped({ git: true })
      const projectService = yield* OpencodeXProject.Service
      const terminalService = yield* OpencodeXTerminalSession.Service
      const viewService = yield* OpencodeXView.Service
      const project = yield* projectService.create({ folders: [directory] })
      const firstSession = yield* projectService.createSession({ projectID: project.id, directory, title: "one" })
      const secondSession = yield* projectService.createSession({ projectID: project.id, directory, title: "two" })
      const firstTerminal = yield* terminalService.create({ directory, installationID: crypto.randomUUID() })
      const secondTerminal = yield* terminalService.create({ directory, installationID: crypto.randomUUID() })
      const created = yield* viewService.create({
        title: "mixed",
        members: [
          { kind: "session", id: firstSession.id },
          { kind: "terminal", id: firstTerminal.id },
          { kind: "session", id: secondSession.id },
          { kind: "terminal", id: secondTerminal.id },
        ],
        focusedItemID: firstTerminal.id,
      })

      expect(created.members).toEqual([
        { kind: "session", id: firstSession.id },
        { kind: "terminal", id: firstTerminal.id },
        { kind: "session", id: secondSession.id },
        { kind: "terminal", id: secondTerminal.id },
      ])
      expect(created.focusedItemID).toBe(firstTerminal.id)
      expect(created.focusedSessionID).toBe(firstSession.id)
      expect(created.sessionIDs).toEqual([firstSession.id, secondSession.id])

      const legacy = yield* viewService.update({
        id: created.id,
        expectedTimeUpdated: created.timeUpdated,
        sessionIDs: [secondSession.id],
      })
      expect(legacy.members).toEqual([
        { kind: "session", id: secondSession.id },
        { kind: "terminal", id: firstTerminal.id },
        { kind: "terminal", id: secondTerminal.id },
      ])
      expect(legacy.focusedItemID).toBe(firstTerminal.id)
      expect(legacy.focusedSessionID).toBe(secondSession.id)

      const terminalOnly = yield* viewService.update({
        id: created.id,
        expectedTimeUpdated: legacy.timeUpdated,
        members: [
          { kind: "terminal", id: secondTerminal.id },
          { kind: "terminal", id: firstTerminal.id },
        ],
        focusedItemID: secondTerminal.id,
      })
      expect(terminalOnly.members.map((member) => member.id)).toEqual([secondTerminal.id, firstTerminal.id])
      expect(terminalOnly.focusedItemID).toBe(secondTerminal.id)
      expect(terminalOnly.focusedSessionID).toBeUndefined()

      yield* terminalService.remove(secondTerminal.id)
      const afterDelete = yield* viewService.get(created.id)
      expect(afterDelete.members).toEqual([{ kind: "terminal", id: firstTerminal.id }])
    }),
  )

  it.live("enforces the shared eight-member limit including pending panes", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped({ git: true })
      const terminalService = yield* OpencodeXTerminalSession.Service
      const viewService = yield* OpencodeXView.Service
      const terminalSessions = yield* Effect.all(
        Array.from({ length: 9 }, () => terminalService.create({ directory, installationID: crypto.randomUUID() })),
        { concurrency: "unbounded" },
      )
      const tooMany = yield* Effect.flip(viewService.create({
        members: terminalSessions.map((session) => ({ kind: "terminal" as const, id: session.id })),
      }))
      expect(tooMany.message).toContain("at most eight")

      const pendingOverflow = yield* Effect.flip(viewService.create({
        members: terminalSessions.slice(0, 8).map((session) => ({ kind: "terminal" as const, id: session.id })),
        metadata: { opencodex: { pendingSessions: [{ id: "pending:one" }] } },
      }))
      expect(pendingOverflow.message).toContain("at most eight")
    }),
  )
})
