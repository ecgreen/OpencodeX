import { expect, test } from "bun:test"
import { initializeTuiTransport } from "../../../src/cli/cmd/tui/thread"

test("explicit-network transport rejection releases worker resources exactly once", async () => {
  const rejection = new Error("explicit network policy rejected")
  let releases = 0

  const error = await initializeTuiTransport(
    async () => Promise.reject(rejection),
    async () => {
      releases += 1
    },
  ).then(
    () => undefined,
    (error) => error,
  )

  expect(error).toBe(rejection)
  expect(releases).toBe(1)
})

test("successful TUI transport initialization leaves cleanup to the normal lifecycle", async () => {
  let releases = 0

  const result = await initializeTuiTransport(
    async () => ({ url: "http://127.0.0.1:4096" }),
    async () => {
      releases += 1
    },
  )

  expect(result).toEqual({ url: "http://127.0.0.1:4096" })
  expect(releases).toBe(0)
})
