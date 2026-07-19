import type { PermissionRequest, QuestionAnswer, QuestionRequest } from "@opencode-ai/sdk/v2/client"
import { Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { buildSafetyQueue, moveSafetyQueueIndex } from "../lib/safety-present"
import { permissionToolPart } from "../lib/tool-display"
import type { MessageBundle } from "../lib/store"
import { SessionPermissionCard } from "./session-permission-card"
import { SessionQuestionCard } from "./session-question-card"

export function SessionSafetyDock(props: {
  permissions: PermissionRequest[]
  questions: QuestionRequest[]
  messages: MessageBundle[]
  replyPermission: (request: PermissionRequest, reply: "once" | "always" | "reject") => void
  replyQuestion: (request: QuestionRequest, answers: QuestionAnswer[]) => void
  rejectQuestion: (request: QuestionRequest) => void
}) {
  const queue = createMemo(() => buildSafetyQueue(props.permissions, props.questions))
  const [activeID, setActiveID] = createSignal<string>()
  let preferredIndex = 0
  let card: HTMLElement | undefined
  let focusFrame = 0
  const activeIndex = createMemo(() => Math.max(0, queue().findIndex((item) => item.id === activeID())))
  const active = createMemo(() => queue()[activeIndex()])

  createEffect(() => {
    const items = queue()
    if (items.some((item) => item.id === activeID())) return
    preferredIndex = Math.min(preferredIndex, Math.max(0, items.length - 1))
    setActiveID(items[preferredIndex]?.id)
  })

  createEffect(() => {
    const id = active()?.id
    if (!id) return
    cancelAnimationFrame(focusFrame)
    focusFrame = requestAnimationFrame(() => card?.focus({ preventScroll: true }))
  })

  onCleanup(() => cancelAnimationFrame(focusFrame))

  const move = (delta: number) => {
    preferredIndex = moveSafetyQueueIndex(activeIndex(), queue().length, delta)
    setActiveID(queue()[preferredIndex]?.id)
  }
  const position = () => ({ index: activeIndex(), total: queue().length, previous: () => move(-1), next: () => move(1) })

  return (
    <div class="safety-dock" role="region" aria-label={`${queue().length} pending request${queue().length === 1 ? "" : "s"}`}>
      <Show when={active()?.id} keyed>
        {(_id) => {
          const item = active()
          if (!item) return <></>
          if (item.kind === "permission") return (
            <SessionPermissionCard
              request={item.request}
              tool={permissionToolPart(item.request, props.messages)}
              position={position()}
              setCard={(element) => { card = element }}
              reply={props.replyPermission}
            />
          )
          return (
            <SessionQuestionCard
              request={item.request}
              position={position()}
              setCard={(element) => { card = element }}
              reply={props.replyQuestion}
              reject={props.rejectQuestion}
            />
          )
        }}
      </Show>
    </div>
  )
}
