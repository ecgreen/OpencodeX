import { afterAll, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import path from "node:path"
import { rememberBackendAuthority } from "../src/main/backend-authority"

const artifacts = path.join(import.meta.dirname, "..", ".artifacts")
await mkdir(artifacts, { recursive: true })
const output = await mkdtemp(path.join(artifacts, "backend-authority-test-"))

afterAll(() => rm(output, { recursive: true, force: true }))

describe("backend authority selection", () => {
  test("persists the GUI database for other local clients", async () => {
    const file = path.join(output, "backend-authority.json")
    const database = path.join(output, "shared.db")

    await rememberBackendAuthority(database, file)

    expect(await Bun.file(file).json()).toMatchObject({ version: 1, database })
  })

  test("does not persist process-local memory databases", async () => {
    const file = path.join(output, "memory-authority.json")

    await rememberBackendAuthority(":memory:", file)

    expect(await Bun.file(file).exists()).toBe(false)
  })
})
