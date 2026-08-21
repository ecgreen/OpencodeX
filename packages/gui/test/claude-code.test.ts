import { afterEach, describe, expect, test } from "bun:test"
import path from "node:path"
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { claudeArguments, readClaudeAuthStatus, resolveClaudeExecutable } from "../src/main/claude-code"
import { isUUID, readInstallationID } from "../src/main/installation-id-store"

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe("Claude Code launch contract", () => {
  test("passes only verified CLI flags; the display name never reaches argv", () => {
    const identity = "11111111-1111-4111-8111-111111111111"

    expect(
      claudeArguments({
        kind: "claude-code",
        mode: "new",
        resumeID: identity,
        installationID: "22222222-2222-4222-8222-222222222222",
        name: "--dangerously-skip-permissions",
      }),
    ).toEqual(["--session-id", identity])
    expect(
      claudeArguments({
        kind: "claude-code",
        mode: "resume",
        resumeID: identity,
        installationID: "22222222-2222-4222-8222-222222222222",
        name: "Ignored while resuming",
      }),
    ).toEqual(["--resume", identity])
  })

  test("resolves a fake native executable from PATH before documented install locations", async () => {
    const root = await temporaryDirectory()
    const first = path.join(root, "first")
    const second = path.join(root, "second")
    await Promise.all([mkdir(first), mkdir(second)])
    await Bun.write(path.join(first, "claude.exe"), "fake")
    await Bun.write(path.join(second, "claude.exe"), "fake")

    expect(
      await resolveClaudeExecutable({
        path: `${first};${second}`,
        home: path.join(root, "home"),
        platform: "win32",
      }),
    ).toBe(path.join(first, "claude.exe"))
  })

  test("uses the documented native user install location when PATH has no Claude executable", async () => {
    const root = await temporaryDirectory()
    const home = path.join(root, "home")
    const executable = path.join(home, ".local", "bin", "claude.exe")
    await mkdir(path.dirname(executable), { recursive: true })
    await Bun.write(executable, "fake")

    expect(await resolveClaudeExecutable({ path: "", home, platform: "win32" })).toBe(executable)
  })

  test("skips directories that shadow the executable name", async () => {
    const root = await temporaryDirectory()
    const bin = path.join(root, "bin")
    await mkdir(path.join(bin, "claude.exe"), { recursive: true })

    expect(await resolveClaudeExecutable({ path: bin, home: path.join(root, "home"), platform: "win32" })).toBeUndefined()
  })

  test("reads the CLI's own auth verdict from its json payload", () => {
    expect(readClaudeAuthStatus('{"loggedIn":true,"authMethod":"claudeai","apiProvider":"firstParty"}')).toEqual({
      state: "signed-in",
      authMethod: "claudeai",
    })
    expect(readClaudeAuthStatus('{"loggedIn":false,"authMethod":"none","apiProvider":"firstParty"}')).toEqual({
      state: "signed-out",
      authMethod: "none",
    })
  })

  test("treats an unreadable verdict as unknown, never as signed out", () => {
    // Clearing the sign-in banner because the CLI changed its output shape
    // would strand the user again, so only an explicit false means signed out.
    expect(readClaudeAuthStatus("not json at all")).toEqual({ state: "unknown" })
    expect(readClaudeAuthStatus('{"apiProvider":"firstParty"}')).toEqual({ state: "unknown" })
    expect(readClaudeAuthStatus('{"loggedIn":"yes"}')).toEqual({ state: "unknown" })
    expect(readClaudeAuthStatus("[]")).toEqual({ state: "unknown" })
    expect(readClaudeAuthStatus("")).toEqual({ state: "unknown" })
  })
})

describe("installation identity", () => {
  test("persists one UUID and repairs invalid local state", async () => {
    const root = await temporaryDirectory()
    const first = await readInstallationID(root)
    const second = await readInstallationID(root)
    expect(isUUID(first)).toBe(true)
    expect(second).toBe(first)
    expect(await readFile(path.join(root, "installation-id"), "utf8")).toBe(`${first}\n`)

    await Bun.write(path.join(root, "installation-id"), "invalid\n")
    const repaired = await readInstallationID(root)
    expect(isUUID(repaired)).toBe(true)
    expect(repaired).not.toBe(first)
  })
})

async function temporaryDirectory() {
  const directory = await mkdtemp(path.join(tmpdir(), "opencodex-claude-test-"))
  directories.push(directory)
  return directory
}
