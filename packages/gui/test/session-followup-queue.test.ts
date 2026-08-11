import { describe, expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import type { Session } from "@opencode-ai/sdk/v2/client"
import { createSessionState, type QueuedSessionPrompt } from "../src/renderer/src/controllers/session-state"
import { createSessionFollowupController } from "../src/renderer/src/components/session-followup-controller"
import { textPrompt, type GuiPromptInfo } from "../src/renderer/src/lib/prompt-state"

describe("GUI session follow-up queue", () => {
  test("keeps multiple queued prompts in FIFO order per session", () => {
    const state = createSessionState()
    const first = state.queuePrompt({
      sessionID: "session-1",
      prompt: textPrompt("first follow-up"),
      agent: "build",
      model: "anthropic/claude-sonnet",
      variant: "fast",
    })
    const second = state.queuePrompt({
      sessionID: "session-1",
      prompt: textPrompt("second follow-up"),
      agent: "plan",
      model: "openai/gpt-5",
      variant: "high",
    })

    expect(state.queuedPrompts("session-1")).toEqual([first, second])
    expect(state.queuedPrompts("session-2")).toEqual([])

    state.removeQueuedPrompt("session-1", first.id)
    expect(state.queuedPrompts("session-1")).toEqual([second])

    state.removeQueuedPrompt("session-1", second.id)
    expect(state.queuedPrompts("session-1")).toEqual([])
  })

  test("edits a queued prompt in place without changing its delivery selection", () => {
    const state = createSessionState()
    const first = state.queuePrompt({
      sessionID: "session-1",
      prompt: textPrompt("original follow-up"),
      agent: "build",
      model: "anthropic/claude-sonnet",
      variant: "fast",
    })
    const second = state.queuePrompt({
      sessionID: "session-1",
      prompt: textPrompt("second follow-up"),
      agent: "plan",
      model: "openai/gpt-5",
      variant: "high",
    })

    state.updateQueuedPrompt("session-1", first.id, "edited follow-up")

    expect(state.queuedPrompts("session-1")).toEqual([
      {
        ...first,
        prompt: textPrompt("edited follow-up"),
      },
      second,
    ])
  })
})

function followupHarness(input?: { queued?: QueuedSessionPrompt[] }) {
  const session = { id: "session-1" } as Session
  const [running, setRunning] = createSignal(true)
  const [prompts, setPrompts] = createSignal<QueuedSessionPrompt[]>(input?.queued ?? [])
  const sent: GuiPromptInfo[] = []
  let dispose!: () => void
  const controller = createRoot((disposer) => {
    dispose = disposer
    return createSessionFollowupController({
      session: () => session,
      running,
      blocked: () => false,
      prompts,
      drainDelayMs: 60,
      remove: (_sessionID, id) => setPrompts((current) => current.filter((item) => item.id !== id)),
      submit: async (prompt) => {
        sent.push(prompt)
        return true
      },
    })
  })
  return { controller, dispose, setRunning, prompts, sent }
}

function submitEvent(value?: string) {
  return { submitter: value === undefined ? null : { value } } as unknown as SubmitEvent
}

function queuedItem(text: string): QueuedSessionPrompt {
  return {
    id: crypto.randomUUID(),
    sessionID: "session-1",
    prompt: textPrompt(text),
    agent: "build",
    model: "anthropic/claude-sonnet",
    variant: "fast",
  }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const settle = () => wait(180)

describe("GUI session follow-up delivery", () => {
  test("plain submit while running queues instead of interrupting", () => {
    // Enter is muscle memory. While a response is running it must never
    // interrupt; interrupting requires the explicit Direct submitter.
    const { controller, dispose } = followupHarness()
    try {
      expect(controller.delivery(submitEvent())).toBe("queue")
      expect(controller.delivery(submitEvent("queue"))).toBe("queue")
      expect(controller.delivery(submitEvent("direct"))).toBe("direct")
    } finally {
      dispose()
    }
  })

  test("submit while idle always queues", () => {
    const { controller, dispose, setRunning } = followupHarness()
    try {
      setRunning(false)
      expect(controller.delivery(submitEvent())).toBe("queue")
      expect(controller.delivery(submitEvent("direct"))).toBe("queue")
    } finally {
      dispose()
    }
  })

  test("a transient idle blip mid-run does not deliver the queued message", async () => {
    // The backend status can read non-busy for a moment while a run is very
    // much alive (stream-error retry handoffs, interrupt gaps, sync lag). A
    // queued message delivered in that window is silently absorbed by the
    // running conversation - the reported "my queued message disappeared".
    // The drain must survive a blip shorter than its delay.
    const { dispose, setRunning, prompts, sent } = followupHarness({ queued: [queuedItem("follow-up")] })
    try {
      setRunning(false)
      await wait(20)
      setRunning(true)
      await settle()
      expect(sent).toHaveLength(0)
      expect(prompts()).toHaveLength(1)
      setRunning(false)
      await settle()
      expect(sent).toHaveLength(1)
      expect(prompts()).toHaveLength(0)
    } finally {
      dispose()
    }
  })

  test("holding the queue pauses auto-send until released", async () => {
    // Editing a queued message must not race its own auto-send when the
    // current run finishes - the hold keeps the head of the queue parked.
    const { controller, dispose, setRunning, prompts, sent } = followupHarness({ queued: [queuedItem("follow-up")] })
    try {
      controller.hold(true)
      setRunning(false)
      await settle()
      expect(sent).toHaveLength(0)
      expect(prompts()).toHaveLength(1)
      controller.hold(false)
      await settle()
      expect(sent).toHaveLength(1)
      expect(prompts()).toHaveLength(0)
    } finally {
      dispose()
    }
  })
})
