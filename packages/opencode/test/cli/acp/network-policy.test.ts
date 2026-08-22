import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { cliIt } from "../../lib/cli-process"
import { createAcpClient } from "./acp-test-client"
import { initialize } from "./helpers"

describe("opencode acp network policy subprocess", () => {
  cliIt.live(
    "rejects a passwordless non-loopback listener",
    ({ opencode }) =>
      Effect.gen(function* () {
        const result = yield* opencode.spawn(["acp", "--hostname", "0.0.0.0", "--port", "0"], {
          env: {
            OPENCODE_SERVER_PASSWORD: "",
            OPENCODE_SERVER_ALLOW_INSECURE_LAN: "1",
          },
        })

        expect(result.exitCode).not.toBe(0)
        expect(result.stderr).toContain("OPENCODE_SERVER_PASSWORD")
      }),
    60_000,
  )

  cliIt.live(
    "rejects an authenticated non-loopback listener without explicit opt-in",
    ({ opencode }) =>
      Effect.gen(function* () {
        const result = yield* opencode.spawn(["acp", "--hostname", "0.0.0.0", "--port", "0"], {
          env: {
            OPENCODE_SERVER_PASSWORD: "acp-test-password",
            OPENCODE_SERVER_ALLOW_INSECURE_LAN: "",
          },
        })

        expect(result.exitCode).not.toBe(0)
        expect(result.stderr).toContain("OPENCODE_SERVER_ALLOW_INSECURE_LAN")
      }),
    60_000,
  )

  cliIt.live(
    "starts an authenticated non-loopback listener with explicit opt-in",
    ({ opencode }) =>
      Effect.gen(function* () {
        const acp = yield* opencode.acp({
          extraArgs: ["--hostname", "0.0.0.0", "--port", "0"],
          env: {
            OPENCODE_SERVER_PASSWORD: "acp-test-password",
            OPENCODE_SERVER_ALLOW_INSECURE_LAN: "true",
          },
        })

        const initialized = yield* initialize(createAcpClient(acp))
        expect(initialized.protocolVersion).toBe(1)
      }),
    60_000,
  )
})
