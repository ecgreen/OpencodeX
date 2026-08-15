import { describe, expect, test } from "bun:test"
import { canAttachCoordinatorAnyway } from "../src/renderer/src/lib/coordinator-version-mismatch"

describe("coordinator version mismatch recovery", () => {
  test("offers an explicit override only for coordinator version mismatches", () => {
    expect(
      canAttachCoordinatorAnyway(
        "Error invoking remote method 'opencodex:connection': CoordinatorVersionMismatchError: versions differ",
      ),
    ).toBe(true)
    expect(canAttachCoordinatorAnyway("Unable to connect to the coordinator")).toBe(false)
    expect(canAttachCoordinatorAnyway(undefined)).toBe(false)
  })
})
