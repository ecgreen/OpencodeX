import type { QuestionAnswer, QuestionRequest } from "@opencode-ai/sdk/v2/client"
import { For, Show, createMemo, createUniqueId } from "solid-js"
import { finalQuestionAnswers, questionAnswersComplete, toggleQuestionAnswer } from "../lib/safety-present"
import { isKeyboardEditingTarget } from "../lib/keyboard-shortcuts"
import { SafetyCardHeader, type SafetyQueuePosition } from "./session-safety-card"
import type { QuestionDraft } from "./session-safety-dock"
import { Button, SurfaceCard, TextField } from "./ui"

/**
 * One question per card: a request with several questions occupies several
 * queue steps, and the top-right pill is the only pagination. The draft lives
 * in the dock so selections survive paging.
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
}) {
  const titleID = `question-title-${createUniqueId()}`
  const question = createMemo(() => props.request.questions[props.step])
  const finalAnswers = createMemo(() => finalQuestionAnswers(props.draft.answers, props.draft.custom))
  const complete = createMemo(() => questionAnswersComplete(props.draft.answers, props.draft.custom))
  const selected = createMemo(() => props.draft.answers[props.step] ?? [])
  const lastStep = () => props.step === props.request.questions.length - 1

  function choose(label: string) {
    const current = question()
    if (!current) return
    const next = toggleQuestionAnswer(props.draft.answers, props.step, label, current.multiple)
    props.updateDraft((draft) => ({ ...draft, answers: next }))
    if (current.multiple) return
    // Single-select: a lone question replies immediately; otherwise the pill
    // advances so the flow keeps moving without a separate Next button.
    if (props.request.questions.length === 1) return props.reply(props.request, next)
    if (!lastStep()) props.position.next()
  }

  function submit() {
    if (complete()) props.reply(props.request, finalAnswers())
  }

  return (
    <SurfaceCard
      class="safety-card question-card"
      tone="info"
      role="dialog"
      aria-labelledby={titleID}
      tabIndex={-1}
      ref={props.setCard}
      onKeyDown={(event) => {
        if (isKeyboardEditingTarget(event.target)) {
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) submit()
          return
        }
        if (event.key === "Escape") props.reject(props.request)
        if (event.key === "Enter") submit()
        if (event.key === "ArrowLeft" && props.position.canNavigate) props.position.previous()
        if (event.key === "ArrowRight" && props.position.canNavigate) props.position.next()
        const option = Number(event.key)
        const chosen = question()?.options[option - 1]
        if (chosen && option >= 1 && option <= 9) choose(chosen.label)
      }}
    >
      <SafetyCardHeader icon="session" label="Question" title={question()?.header ?? "Input needed"} titleID={titleID} position={props.position} />

      <div class="safety-card-body question-card-body">
        <Show when={question()}>
          {(current) => (
            <div class="question-step">
              <p>{current().question}</p>
              <div class="question-options" role={current().multiple ? "group" : "radiogroup"} aria-label={current().header}>
                <For each={current().options}>
                  {(option, index) => (
                    <Button
                      class="question-option"
                      classList={{ "is-selected": selected().includes(option.label) }}
                      appearance="ghost"
                      role={current().multiple ? "checkbox" : "radio"}
                      aria-checked={selected().includes(option.label)}
                      aria-keyshortcuts={index() < 9 ? String(index() + 1) : undefined}
                      onClick={() => choose(option.label)}
                    >
                      <kbd aria-hidden="true">{index() + 1}</kbd>
                      <span class="question-option-copy"><strong>{option.label}</strong><Show when={option.description}><small>{option.description}</small></Show></span>
                    </Button>
                  )}
                </For>
              </div>
              <Show when={current().custom !== false}>
                <TextField
                  fieldClass="question-custom-answer"
                  label="Custom answer"
                  value={props.draft.custom[props.step] ?? ""}
                  onInput={(event) => {
                    const value = event.currentTarget.value
                    props.updateDraft((draft) => ({
                      ...draft,
                      custom: draft.custom.map((current, index) => (index === props.step ? value : current)),
                    }))
                  }}
                  placeholder="Type a different answer"
                />
              </Show>
            </div>
          )}
        </Show>
      </div>

      <footer class="safety-card-actions question-actions">
        <Button appearance="ghost" tone="danger" leadingIcon="x" onClick={() => props.reject(props.request)}>Dismiss</Button>
        <span class="safety-action-spacer" />
        <Show when={props.request.questions.length > 1}>
          <span class="question-answer-progress" aria-hidden="true">
            {finalAnswers().filter((answer) => answer.length > 0).length} of {props.request.questions.length} answered
          </span>
        </Show>
        <Button appearance="solid" tone="accent" trailingIcon="send" disabled={!complete()} onClick={submit}>
          Reply
        </Button>
      </footer>
    </SurfaceCard>
  )
}
