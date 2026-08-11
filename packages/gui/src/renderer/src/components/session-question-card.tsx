import type { QuestionAnswer, QuestionRequest } from "@opencode-ai/sdk/v2/client"
import { For, Show, createMemo, createSignal, createUniqueId, onCleanup } from "solid-js"
import { Markdown } from "@opencode-ai/ui/markdown"
import { finalQuestionAnswers, nextUnansweredStep, questionAnswersComplete, toggleQuestionAnswer } from "../lib/safety-present"
import { isKeyboardEditingTarget } from "../lib/keyboard-shortcuts"
import { SafetyCardHeader, type SafetyQueuePosition } from "./session-safety-card"
import { SafetyDismissConfirm } from "./session-safety-confirm"
import type { QuestionDraft } from "./session-safety-dock"
import { Button, Dialog, SurfaceCard, TextField } from "./ui"

const CONFIRM_PULSE_MS = 200

/**
 * One question per card; the top-right pill is the only pagination. There is no
 * footer: a selection that completes the whole request submits it (after a
 * short confirmation pulse), and anything less advances to the next unanswered
 * question. Dismissing always confirms first. The draft lives in the dock so
 * selections survive paging.
 */
export function SessionQuestionCard(props: {
  request: QuestionRequest
  step: number
  draft: QuestionDraft
  updateDraft: (update: (draft: QuestionDraft) => QuestionDraft) => void
  position: SafetyQueuePosition
  setCard: (element: HTMLElement) => void
  reply: (request: QuestionRequest, answers: QuestionAnswer[]) => void
  reject: (request: QuestionRequest) => void
  context?: { text?: string; plan?: string }
}) {
  const titleID = `question-title-${createUniqueId()}`
  const [confirmOpen, setConfirmOpen] = createSignal(false)
  const [planOpen, setPlanOpen] = createSignal(false)
  const [pulsing, setPulsing] = createSignal<string>()
  let card: HTMLElement | undefined
  let submitTimer: ReturnType<typeof setTimeout> | undefined
  let submitted = false
  const question = createMemo(() => props.request.questions[props.step])
  const selected = createMemo(() => props.draft.answers[props.step] ?? [])
  const customValue = createMemo(() => props.draft.custom[props.step] ?? "")
  const complete = createMemo(() => questionAnswersComplete(props.draft.answers, props.draft.custom))
  const stepAnswered = createMemo(() => (finalQuestionAnswers(props.draft.answers, props.draft.custom)[props.step] ?? []).length > 0)

  onCleanup(() => clearTimeout(submitTimer))

  const reduceMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false

  function submitWith(answers: QuestionAnswer[], custom: string[]) {
    if (submitted) return
    submitted = true
    props.reply(props.request, finalQuestionAnswers(answers, custom))
  }

  /** After a selection settles: submit when the request is complete, else advance. */
  function settle(answers: QuestionAnswer[], custom: string[], pulseLabel?: string) {
    const done = questionAnswersComplete(answers, custom)
    const act = () => {
      if (done) return submitWith(answers, custom)
      const next = nextUnansweredStep(answers, custom, props.step)
      if (next === undefined || !props.position.canNavigate) return
      const steps = props.request.questions.length
      const forward = (next - props.step + steps) % steps
      if (forward <= steps - forward) for (let i = 0; i < forward; i++) props.position.next()
      else for (let i = 0; i < steps - forward; i++) props.position.previous()
    }
    if (!pulseLabel || reduceMotion()) return act()
    setPulsing(pulseLabel)
    clearTimeout(submitTimer)
    submitTimer = setTimeout(() => {
      setPulsing(undefined)
      act()
    }, CONFIRM_PULSE_MS)
  }

  function choose(label: string) {
    const current = question()
    if (!current) return
    const answers = toggleQuestionAnswer(props.draft.answers, props.step, label, current.multiple)
    props.updateDraft((draft) => ({ ...draft, answers }))
    if (!current.multiple) settle(answers, props.draft.custom, label)
  }

  /** Enter / the inline confirm: send when complete, otherwise move along. */
  function confirmStep() {
    if (complete()) return submitWith(props.draft.answers, props.draft.custom)
    if (stepAnswered()) settle(props.draft.answers, props.draft.custom)
  }

  return (
    <SurfaceCard
      class="safety-card question-card"
      tone="info"
      role="dialog"
      aria-labelledby={titleID}
      tabIndex={-1}
      ref={(element: HTMLElement) => {
        card = element
        props.setCard(element)
      }}
      onKeyDown={(event) => {
        if (isKeyboardEditingTarget(event.target)) {
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && complete()) submitWith(props.draft.answers, props.draft.custom)
          return
        }
        if (event.key === "Escape") setConfirmOpen(true)
        if (event.key === "Enter") confirmStep()
        if (event.key === "ArrowLeft" && props.position.canNavigate) props.position.previous()
        if (event.key === "ArrowRight" && props.position.canNavigate) props.position.next()
        const option = Number(event.key)
        const chosen = question()?.options[option - 1]
        if (chosen && option >= 1 && option <= 9) choose(chosen.label)
      }}
    >
      <SafetyCardHeader
        icon="session"
        label="Question"
        titleID={titleID}
        position={props.position}
        dismissLabel="Dismiss question"
        onDismiss={() => setConfirmOpen(true)}
      />

      <div class="safety-card-body question-card-body">
        <Show when={props.context?.text || props.context?.plan}>
          <div class="question-context">
            <Show when={props.context?.text}>
              {(text) => <div class="question-context-text"><Markdown text={text()} /></div>}
            </Show>
            <Show when={props.context?.plan}>
              <Button appearance="outline" size="compact" leadingIcon="file" onClick={() => setPlanOpen(true)}>View plan</Button>
            </Show>
          </div>
        </Show>
        <Show when={question()}>
          {(current) => (
            <div class="question-step">
              <h2 class="question-headline">{current().question}</h2>
              <div class="question-options" role={current().multiple ? "group" : "radiogroup"} aria-label={current().header}>
                <For each={current().options}>
                  {(option, index) => (
                    <Button
                      class="question-option"
                      classList={{ "is-selected": selected().includes(option.label), "is-pulsing": pulsing() === option.label }}
                      appearance="ghost"
                      role={current().multiple ? "checkbox" : "radio"}
                      aria-checked={selected().includes(option.label)}
                      aria-keyshortcuts={index() < 9 ? String(index() + 1) : undefined}
                      style={{ "--option-index": String(index()) }}
                      onClick={() => choose(option.label)}
                    >
                      <kbd aria-hidden="true">{index() + 1}</kbd>
                      <span class="question-option-copy"><strong>{option.label}</strong><Show when={option.description}><small>{option.description}</small></Show></span>
                      <Show when={current().multiple}><span class="question-option-check" aria-hidden="true" /></Show>
                    </Button>
                  )}
                </For>
              </div>
              <Show when={current().custom !== false}>
                <TextField
                  fieldClass="question-custom-answer"
                  label="Or type your own answer"
                  value={customValue()}
                  onInput={(event) => {
                    const value = event.currentTarget.value
                    props.updateDraft((draft) => ({
                      ...draft,
                      custom: draft.custom.map((current, index) => (index === props.step ? value : current)),
                    }))
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" || event.ctrlKey || event.metaKey) return
                    event.preventDefault()
                    if (customValue().trim()) settle(props.draft.answers, props.draft.custom)
                  }}
                  placeholder="Type a different answer"
                />
              </Show>
              <Show when={current().multiple && stepAnswered()}>
                <div class="question-inline-confirm">
                  <Button appearance="solid" tone="accent" trailingIcon={complete() ? "send" : "chevronRight"} onClick={confirmStep}>
                    {complete() ? "Send answers" : "Next"}
                  </Button>
                </div>
              </Show>
            </div>
          )}
        </Show>
      </div>

      <SafetyDismissConfirm
        open={confirmOpen()}
        title="Dismiss this question?"
        body="Claude is waiting on your answer. Dismissing rejects the question and Claude continues without your input."
        confirmLabel="Dismiss"
        onConfirm={() => {
          setConfirmOpen(false)
          props.reject(props.request)
        }}
        onCancel={() => {
          setConfirmOpen(false)
          requestAnimationFrame(() => card?.focus({ preventScroll: true }))
        }}
      />
      <Show when={props.context?.plan}>
        {(plan) => (
          <Dialog open={planOpen()} onClose={() => setPlanOpen(false)} title="Proposed plan" size="lg" class="safety-plan-dialog">
            <div class="tool-plan"><Markdown text={plan()} /></div>
          </Dialog>
        )}
      </Show>
    </SurfaceCard>
  )
}
