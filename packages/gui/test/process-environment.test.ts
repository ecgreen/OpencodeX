import { describe, expect, test } from "bun:test"
import path from "node:path"
import { coordinatorEnvironment } from "../src/main/process-environment"

describe("coordinator environment", () => {
  test("enriches a sparse macOS PATH without duplicating inherited entries", () => {
    const environment = coordinatorEnvironment(
      { PATH: ["/usr/bin", "/opt/homebrew/bin", "/bin"].join(path.posix.delimiter), CUSTOM: "preserved" },
      "/Users/example",
      "darwin",
    )

    expect(environment.CUSTOM).toBe("preserved")
    expect(environment.PATH?.split(path.posix.delimiter)).toEqual([
      "/Users/example/.bun/bin",
      "/Users/example/.local/bin",
      "/opt/homebrew/bin",
      "/usr/local/bin",
      "/usr/bin",
      "/bin",
      "/usr/sbin",
      "/sbin",
    ])
  })

  test("includes standard Unix tools when the inherited PATH is missing", () => {
    expect(coordinatorEnvironment({}, "/home/example", "linux").PATH?.split(path.posix.delimiter)).toEqual([
      "/home/example/.bun/bin",
      "/home/example/.local/bin",
      "/usr/local/bin",
      "/usr/bin",
      "/bin",
      "/usr/sbin",
      "/sbin",
    ])
  })

  test("leaves Windows PATH handling unchanged", () => {
    const source = { PATH: "C:\\Tools;C:\\Windows", CUSTOM: "preserved" }
    expect(coordinatorEnvironment(source, "C:\\Users\\example", "win32")).toEqual(source)
  })
})
