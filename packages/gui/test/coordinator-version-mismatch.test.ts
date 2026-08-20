import { describe, expect, test } from "bun:test"
import { canAttachCoordinatorAnyway } from "../src/renderer/src/lib/coordinator-version-mismatch"
import { COORDINATOR_VERSION_MISMATCH } from "../src/shared/connection"
import { GuiConnectionError, unwrapGuiConnection } from "../src/renderer/src/lib/client"
import { failedGuiConnection } from "../src/main/connection-result"
import { CoordinatorVersionMismatchError } from "../src/main/sidecar-state"

describe("coordinator version mismatch recovery", () => {
  test("preserves the mismatch code while unwrapping the serialized IPC result", () => {
    expect(unwrapGuiConnection({
      ok: true,
      value: { url: "http://127.0.0.1:4096", directory: "/repo", restartBackend: true },
    })).toEqual({ url: "http://127.0.0.1:4096", directory: "/repo", restartBackend: true })

    const envelope = structuredClone(
      failedGuiConnection(new CoordinatorVersionMismatchError("versions: secret-build-id")),
    )
    expect(() => unwrapGuiConnection(envelope)).toThrow(GuiConnectionError)

    try {
      unwrapGuiConnection(envelope)
    } catch (error) {
      expect(error).toMatchObject({
        message: "The coordinator version does not match this OpencodeX GUI.",
        code: COORDINATOR_VERSION_MISMATCH,
      })
      expect(canAttachCoordinatorAnyway(error)).toBe(true)
    }
  })

  test("shows Attach anyway only for the structured mismatch code", () => {
    expect(canAttachCoordinatorAnyway({ code: COORDINATOR_VERSION_MISMATCH })).toBe(true)
    expect(canAttachCoordinatorAnyway(new Error("CoordinatorVersionMismatchError: versions differ"))).toBe(false)
    expect(canAttachCoordinatorAnyway({ code: "CONNECTION_REFUSED" })).toBe(false)
    expect(canAttachCoordinatorAnyway(undefined)).toBe(false)
  })

  test("does not serialize secret-bearing backend errors", () => {
    const result = failedGuiConnection(new Error("spawn failed with password super-secret"))
    expect(result).toEqual({
      ok: false,
      error: { message: "Unable to connect to the OpencodeX backend." },
    })
    expect(JSON.stringify(result)).not.toContain("super-secret")

    const mismatch = failedGuiConnection(new CoordinatorVersionMismatchError("versions: secret-build-id"))
    expect(mismatch).toEqual({
      ok: false,
      error: {
        message: "The coordinator version does not match this OpencodeX GUI.",
        code: COORDINATOR_VERSION_MISMATCH,
      },
    })
    expect(JSON.stringify(mismatch)).not.toContain("secret-build-id")
  })
})
