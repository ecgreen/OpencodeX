import type { PermissionRequest, QuestionAnswer, QuestionRequest } from "@opencode-ai/sdk/v2/client"
import { Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { buildSafetyQueue, latestAssistantContext, moveSafetyQueueIndex, safetyQueueGroup } from "../lib/safety-present"
import { permissionToolPart } from "../lib/tool-display"
import type { MessageBundle } from "../lib/session-api"
import { SessionPermissionCard } from "./session-permission-card"
import { SessionQuestionCard } from "./session-question-card"

type QuestionDraft = { answers: QuestionAnswer[]; custom: string[] }

export function SessionSafetyDock(props: {
  permissions: PermissionRequest[]
  questions: QuestionRequest[]
  messages: MessageBundle[]
  replyPermission: (request: PermissionRequest, reply: "once" | "always" | "reject") => void
  replyQuestion: (request: QuestionRequest, answers: QuestionAnswer[]) => void
  rejectQuestion: (request: QuestionRequest) => void
}) {
  const queue = createMemo(() => buildSafetyQueue(props.permissions, props.questions))
  const context = createMemo(() => latestAssistantContext(props.messages))
  const [activeID, setActiveID] = createSignal<string>()
  // Selections survive paging between question steps: the draft lives here,
  // keyed by request, not inside the per-step card.
  const [drafts, setDrafts] = createSignal<Record<string, QuestionDraft>>({})
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
    const pending = new Set(props.questions.map((request) => request.id))
    setDrafts((current) => {
      const stale = Object.keys(current).filter((id) => !pending.has(id))
      if (stale.length === 0) return current
      const next = { ...current }
      for (const id of stale) delete next[id]
      return next
    })
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
  const position = () => {
    const group = safetyQueueGroup(queue(), activeIndex())
    return {
      index: group.index,
      total: group.total,
      upNext: group.upNext,
      canNavigate: queue().length > 1,
      previous: () => move(-1),
      next: () => move(1),
    }
  }
  const draftFor = (request: QuestionRequest): QuestionDraft =>
    drafts()[request.id] ?? {
      answers: request.questions.map(() => []),
      custom: request.questions.map(() => ""),
    }
  const updateDraft = (request: QuestionRequest, update: (draft: QuestionDraft) => QuestionDraft) =>
    setDrafts((current) => ({ ...current, [request.id]: update(current[request.id] ?? draftFor(request)) }))

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
              step={item.step}
              draft={draftFor(item.request)}
              updateDraft={(update) => updateDraft(item.request, update)}
              position={position()}
              setCard={(element) => { card = element }}
              reply={props.replyQuestion}
              reject={props.rejectQuestion}
              context={context()}
            />
          )
        }}
      </Show>
    </div>
  )
}

export type { QuestionDraft }
