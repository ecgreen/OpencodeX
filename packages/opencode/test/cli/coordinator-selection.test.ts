import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import fs from "fs/promises"
import path from "path"
import {
  coordinatorDatabaseIdentity,
  coordinatorClientDir,
  discoverActiveGuiCoordinatorDatabase,
  readActiveCoordinatorClientLeases,
  readBackendAuthority,
  selectBackendAuthority,
} from "../../src/cli/cmd/tui/coordinator-registry"
import { discoverBackendDatabase } from "../../src/cli/cmd/tui/database-discovery"
import { tmpdir } from "../fixture/fixture"

describe("local coordinator database selection", () => {
  test("uses the GUI authority database across installation channels", async () => {
    await using tmp = await tmpdir()
    const database = path.join(tmp.path, "gui.db")
    const selection = path.join(tmp.path, "backend-authority.json")
    await Bun.write(database, "")
    await Bun.write(selection, JSON.stringify({ version: 1, database, updatedAt: Date.now() }))

    const authority = await readBackendAuthority(selection)
    const expected = coordinatorDatabaseIdentity(database)

    expect(authority).toBe(expected)
    expect(selectBackendAuthority(undefined, authority, undefined, path.join(tmp.path, "channel.db"))).toBe(expected)
  })

  test("prefers an active GUI authority over persisted and channel databases", async () => {
    const active = coordinatorDatabaseIdentity("active.db")

    expect(selectBackendAuthority(active, "persisted.db", "discovered.db", "channel.db")).toBe(active)
  })

  test("discovers a healthy coordinator with an active GUI lease", async () => {
    await using tmp = await tmpdir()
    const database = path.join(tmp.path, "gui.db")
    const key = "gui-authority"
    const clients = path.join(tmp.path, `${key}.clients`)
    await Bun.write(database, "")
    await Bun.write(path.join(clients, `${process.pid}.gui.json`), JSON.stringify({
      version: 1,
      key,
      pid: process.pid,
      updatedAt: Date.now(),
    }))
    const server = Bun.serve({
      port: 0,
      fetch: () => Response.json({ healthy: true }),
    })
    await Bun.write(path.join(tmp.path, `${key}.json`), JSON.stringify({
      version: 2,
      key,
      directory: tmp.path,
      database,
      pid: process.pid,
      url: server.url.href,
      username: "gui",
      password: "secret",
      token: "token",
      createdAt: new Date().toISOString(),
    }))

    try {
      expect(await discoverActiveGuiCoordinatorDatabase(tmp.path)).toBe(coordinatorDatabaseIdentity(database))
    } finally {
      await server.stop(true)
    }
  })

  test("preserves a replacing lease owned by a live process", async () => {
    const key = `lease-test-${process.pid}-${Date.now()}`
    const clients = coordinatorClientDir(key)
    const file = path.join(clients, `${process.pid}.gui.json`)
    await fs.mkdir(clients, { recursive: true })
    await Bun.write(file, "{")

    try {
      expect(await readActiveCoordinatorClientLeases(key)).toEqual([
        expect.objectContaining({ key, pid: process.pid }),
      ])
      expect(await Bun.file(file).exists()).toBe(true)
    } finally {
      await fs.rm(clients, { force: true, recursive: true })
    }
  })

  test("ignores missing and malformed authority databases", async () => {
    await using tmp = await tmpdir()
    const selection = path.join(tmp.path, "backend-authority.json")
    await Bun.write(selection, JSON.stringify({ version: 1, database: path.join(tmp.path, "missing.db") }))

    expect(await readBackendAuthority(selection)).toBeUndefined()
  })

  test("discovers the populated OpencodeX database on first upgrade", async () => {
    await using tmp = await tmpdir()
    createDatabase(path.join(tmp.path, "opencode-empty.db"), 0, 0)
    const populated = path.join(tmp.path, "opencode-feature.db")
    createDatabase(populated, 2, 12)
    createDatabase(path.join(tmp.path, "opencode-other.db"), 1, 3)

    expect(await discoverBackendDatabase(tmp.path)).toBe(populated)
  })
})

function createDatabase(file: string, projects: number, sessions: number) {
  const database = new Database(file, { create: true })
  database.run("CREATE TABLE opencodex_project (id TEXT PRIMARY KEY)")
  database.run("CREATE TABLE session (id TEXT PRIMARY KEY)")
  Array.from({ length: projects }).forEach((_, index) =>
    database.run("INSERT INTO opencodex_project VALUES (?)", [`project-${index}`]),
  )
  Array.from({ length: sessions }).forEach((_, index) =>
    database.run("INSERT INTO session VALUES (?)", [`session-${index}`]),
  )
  database.close()
}
