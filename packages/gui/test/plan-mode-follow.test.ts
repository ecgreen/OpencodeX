import { describe, expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import type { GlobalEvent } from "@opencode-ai/sdk/v2/client"
import { createPlanModeFollow } from "../src/renderer/src/lib/plan-mode-follow"

describe("composer plan mode follow", () => {
  test("follows the session's own plan_enter and plan_exit switches", () => {
    const follow = harness("ses_1")

    follow.publish(planEvent("prt_1", "plan_enter", "ses_1"))
    expect(follow.agent()).toBe("plan")

    follow.publish(planEvent("prt_2", "plan_exit", "ses_1"))
    expect(follow.agent()).toBe("build")

    follow.dispose()
  })

  test("ignores other sessions, running calls, and unrelated tools", () => {
    const follow = harness("ses_1")

    follow.publish(planEvent("prt_1", "plan_enter", "ses_2"))
    follow.publish(planEvent("prt_2", "plan_enter", "ses_1", "running"))
    follow.publish(planEvent("prt_3", "bash", "ses_1"))
    expect(follow.agent()).toBe("")

    follow.dispose()
  })

  test("a re-delivered switch cannot undo a later manual change", () => {
    const follow = harness("ses_1")

    follow.publish(planEvent("prt_1", "plan_enter", "ses_1"))
    expect(follow.agent()).toBe("plan")
    follow.setAgent("build")
    follow.publish(planEvent("prt_1", "plan_enter", "ses_1"))

    expect(follow.agent()).toBe("build")
    follow.dispose()
  })

  test("stops following once disposed", () => {
    const follow = harness("ses_1")
    follow.dispose()
    follow.publish(planEvent("prt_1", "plan_enter", "ses_1"))
    expect(follow.agent()).toBe("")
  })
})

function harness(activeSessionID: string) {
  const listeners = new Set<(event: GlobalEvent) => void>()
  const [agent, setAgent] = createSignal("")
  const dispose = createRoot((disposeRoot) => {
    createPlanModeFollow({
      subscribe: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      activeSessionID: () => activeSessionID,
      setAgent,
    })
    return disposeRoot
  })
  return {
    agent,
    setAgent,
    dispose,
    publish: (event: GlobalEvent) => listeners.forEach((listener) => listener(event)),
  }
}

function planEvent(partID: string, tool: string, sessionID: string, status = "completed") {
  // The generated GlobalEvent union correlates payload names and data; a fixture cannot express that.
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
  return {
    directory: "/repo",
    payload: {
      id: `evt_${partID}`,
      type: "message.part.updated",
      properties: {
        part: { id: partID, sessionID, messageID: "msg_1", type: "tool", tool, callID: partID, state: { status } },
      },
    },
  } as unknown as GlobalEvent
}
