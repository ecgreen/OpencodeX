import { describe, expect, mock, test } from "bun:test"

// terminal-ipc.ts imports "electron" at module scope for the IPC handlers this
// test doesn't exercise; outside a real Electron process that import has no
// named exports, so stub it before the dynamic import below pulls the module in.
await mock.module("electron", () => ({ app: {}, ipcMain: {} }))

const { validTerminalLaunchProfile } = await import("../src/main/terminal-ipc")

describe("terminal launch profile validation", () => {
  test("accepts the sign-in profile, which carries no conversation identity", () => {
    expect(validTerminalLaunchProfile({ kind: "claude-login" })).toEqual({ kind: "claude-login" })
  })

  test("ignores conversation fields smuggled onto a sign-in profile", () => {
    expect(
      validTerminalLaunchProfile({
        kind: "claude-login",
        resumeID: "11111111-1111-4111-8111-111111111111",
        name: "--dangerously-skip-permissions",
      }),
    ).toEqual({ kind: "claude-login" })
  })

  test("still validates the profiles that already existed", () => {
    expect(validTerminalLaunchProfile({ kind: "shell" })).toEqual({ kind: "shell" })
    expect(validTerminalLaunchProfile({ kind: "claude-code", mode: "new" })).toBeUndefined()
    expect(validTerminalLaunchProfile({ kind: "nonsense" })).toBeUndefined()
    expect(validTerminalLaunchProfile(undefined)).toBeUndefined()
  })
})
