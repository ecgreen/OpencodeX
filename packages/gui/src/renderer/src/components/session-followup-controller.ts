import type { Session } from "@opencode-ai/sdk/v2/client"
import { createEffect, createSignal, onCleanup, type Accessor } from "solid-js"
import type { QueuedSessionPrompt } from "../controllers/session-state"
import type { GuiPromptInfo } from "../lib/prompt-state"
import type { PromptDelivery } from "../lib/session-api"

/**
 * How long the session must read as not-running before the queue drains.
 * The status the GUI sees round-trips through a server sync and can read
 * non-busy for a moment while a run is still alive (retry handoffs after a
 * stream error, interrupt gaps, sync lag). A drain fired inside such a blip
 * delivers the queued message into the running conversation, where it is
 * silently absorbed - the queue item just vanishes. The delay must comfortably
 * outlast one status round-trip; any flap inside it cancels the drain.
 */
const QUEUE_DRAIN_DELAY_MS = 1200

export function createSessionFollowupController(input: {
  session: Accessor<Session | undefined>
  running: Accessor<boolean>
  blocked: Accessor<boolean>
  prompts: Accessor<QueuedSessionPrompt[]>
  queue?: (prompt: Omit<QueuedSessionPrompt, "id">) => void
  update?: (sessionID: string, id: string, value: string) => void
  remove?: (sessionID: string, id: string) => void
  /** Test override for the drain delay. */
  drainDelayMs?: number
  submit: (
    prompt: GuiPromptInfo,
    options?: { delivery?: PromptDelivery; agent?: string; model?: string; variant?: string },
  ) => Promise<boolean>
}) {
  let sendTimer: ReturnType<typeof setTimeout> | undefined
  let sendingID = ""
  // Held while a queued message is being edited or its removal confirmed, so
  // auto-send cannot race the dialog and deliver the message mid-edit.
  const [held, setHeld] = createSignal(false)
  createEffect(() => {
    clearTimeout(sendTimer)
    const session = input.session()
    const item = input.prompts()[0]
    if (!session || !item || input.running() || input.blocked() || held() || sendingID) return
    sendTimer = setTimeout(() => {
      if (
        input.session()?.id !== session.id ||
        input.prompts()[0]?.id !== item.id ||
        input.running() ||
        input.blocked() ||
        held()
      )
        return
      sendingID = item.id
      void input
        .submit(item.prompt, {
          delivery: "queue",
          agent: item.agent,
          model: item.model,
          variant: item.variant,
        })
        .then((accepted) => {
          if (!accepted) return
          input.remove?.(session.id, item.id)
        })
        .finally(() => {
          sendingID = ""
        })
    }, input.drainDelayMs ?? QUEUE_DRAIN_DELAY_MS)
  })
  onCleanup(() => clearTimeout(sendTimer))

  function queue(
    prompt: GuiPromptInfo,
    selection: { agent: string; model: string; variant: string },
  ) {
    const session = input.session()
    if (!session || !input.running() || !input.queue) return false
    input.queue({ sessionID: session.id, prompt, ...selection })
    return true
  }

  return {
    delivery(event: SubmitEvent): PromptDelivery {
      if (!input.running()) return "queue"
      // Queue is the default: plain Enter mid-run must never interrupt the
      // running response. Direct requires its explicit submitter.
      return event.submitter !== null && "value" in event.submitter && event.submitter.value === "direct"
        ? "direct"
        : "queue"
    },
    hold: setHeld,
    queue,
    prompts: () => input.prompts().map((item) => ({
      id: item.id,
      text: promptText(item.prompt),
      input: item.prompt.input,
      hasAttachments: item.prompt.parts.some((part) => part.type !== "text"),
    })),
    update(id: string, value: string) {
      const session = input.session()
      if (session) input.update?.(session.id, id, value)
    },
    remove(id: string) {
      const session = input.session()
      if (session) input.remove?.(session.id, id)
    },
  }
}

function promptText(prompt: GuiPromptInfo) {
  const text = prompt.input.trim().split(/\r?\n/).find(Boolean)
  if (text) return text
  return prompt.parts.find((part) => part.type === "file")?.filename ?? "Attached context"
}
