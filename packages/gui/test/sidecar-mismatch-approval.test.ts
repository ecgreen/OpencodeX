import { describe, expect, test } from "bun:test"
import { createCoordinatorMismatchApproval } from "../src/main/sidecar-state"
import { confirmCoordinatorVersionMismatch } from "../src/main/version-mismatch-confirmation"

describe("coordinator mismatch approval", () => {
  test("rejects without pending mismatch before showing a dialog", async () => {
    const approval = createCoordinatorMismatchApproval()
    let dialogs = 0
    await expect(confirmCoordinatorVersionMismatch({
      window: { id: "requesting-window" },
      pending: () => approval.pending(),
      approve: (identity) => approval.approve(identity),
      showMessageBox: async () => {
        dialogs += 1
        return { response: 1 }
      },
    })).rejects.toThrow("No coordinator version mismatch is pending.")
    expect(dialogs).toBe(0)
  })

  test("confirmed pending approval works once and binds the requesting window", async () => {
    const approval = createCoordinatorMismatchApproval()
    const identity = { key: "database-key", token: "coordinator-token" }
    const window = { id: "requesting-window" }
    let dialogWindow: typeof window | undefined
    approval.observe(identity)

    expect(await confirmCoordinatorVersionMismatch({
      window,
      pending: () => approval.pending(),
      approve: (identity) => approval.approve(identity),
      showMessageBox: async (owner, options) => {
        dialogWindow = owner
        expect(options).toMatchObject({
          buttons: ["Cancel", "Attach anyway"],
          defaultId: 0,
          cancelId: 0,
        })
        return { response: 1 }
      },
    })).toBe(true)

    expect(dialogWindow).toBe(window)
    expect(approval.consume(identity)).toBe(true)
    expect(approval.consume(identity)).toBe(false)
  })

  test("cancel does not approve", async () => {
    const approval = createCoordinatorMismatchApproval()
    const identity = { key: "database-key", token: "coordinator-token" }
    approval.observe(identity)

    expect(await confirmCoordinatorVersionMismatch({
      window: { id: "requesting-window" },
      pending: () => approval.pending(),
      approve: (identity) => approval.approve(identity),
      showMessageBox: async () => ({ response: 0 }),
    })).toBe(false)
    expect(approval.consume(identity)).toBe(false)
  })

  test("refuses and consumes approval when the manifest changes", () => {
    const approval = createCoordinatorMismatchApproval()
    const identity = { key: "database-key", token: "first-token" }
    approval.observe(identity)
    approval.approve(identity)

    expect(approval.consume({ key: "database-key", token: "replacement-token" })).toBe(false)
    expect(approval.consume({ key: "database-key", token: "first-token" })).toBe(false)
  })
})
