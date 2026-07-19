import type { QuestionAnswer, QuestionRequest } from "@opencode-ai/sdk/v2/client"
import { For, Show, createMemo, createSignal, createUniqueId } from "solid-js"
import { finalQuestionAnswers, questionAnswersComplete, toggleQuestionAnswer } from "../lib/safety-present"
import { isKeyboardEditingTarget } from "../lib/keyboard-shortcuts"
import { SafetyCardHeader, type SafetyQueuePosition } from "./session-safety-card"
import { Button, SurfaceCard, TextField } from "./ui"

export function SessionQuestionCard(props: {
  request: QuestionRequest
  position: SafetyQueuePosition
  setCard: (element: HTMLElement) => void
  reply: (request: QuestionRequest, answers: QuestionAnswer[]) => void
  reject: (request: QuestionRequest) => void
}) {
  const titleID = `question-title-${createUniqueId()}`
  const [answers, setAnswers] = createSignal<QuestionAnswer[]>(props.request.questions.map(() => []))
  const [custom, setCustom] = createSignal(props.request.questions.map(() => ""))
  const [active, setActive] = createSignal(0)
  const question = createMemo(() => props.request.questions[active()])
  const finalAnswers = createMemo(() => finalQuestionAnswers(answers(), custom()))
  const valid = createMemo(() => questionAnswersComplete(answers(), custom()))
  const currentValid = createMemo(() => (finalAnswers()[active()]?.length ?? 0) > 0)
  const last = () => props.request.questions.length - 1

  function choose(label: string) {
    const current = question()
    if (!current) return
    const next = toggleQuestionAnswer(answers(), active(), label, current.multiple)
    setAnswers(next)
    if (props.request.questions.length === 1 && !current.multiple) return props.reply(props.request, next)
    if (!current.multiple && active() < last()) setActive((index) => index + 1)
  }

  function submitStep() {
    if (!currentValid()) return
    if (active() < last()) {
      setActive((index) => index + 1)
      return
    }
    if (valid()) props.reply(props.request, finalAnswers())
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
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) submitStep()
          return
        }
        if (event.key === "Escape") props.reject(props.request)
        if (event.key === "ArrowLeft" && props.position.total > 1) props.position.previous()
        if (event.key === "ArrowRight" && props.position.total > 1) props.position.next()
        const option = Number(event.key)
        const selected = question()?.options[option - 1]
        if (selected && option >= 1 && option <= 9) choose(selected.label)
      }}
    >
      <SafetyCardHeader icon="session" label="Question" title={question()?.header ?? "Input needed"} titleID={titleID} position={props.position} />

      <div class="safety-card-body question-card-body">
        <Show when={props.request.questions.length > 1}>
          <div class="question-progress"><span>Question {active() + 1} of {props.request.questions.length}</span><progress value={active() + 1} max={props.request.questions.length} /></div>
        </Show>
        <Show when={question()}>
          {(current) => (
            <div class="question-step">
              <p>{current().question}</p>
              <div class="question-options" role={current().multiple ? "group" : "radiogroup"} aria-label={current().header}>
                <For each={current().options}>
                  {(option, index) => (
                    <Button
                      class="question-option"
                      classList={{ "is-selected": answers()[active()]?.includes(option.label) }}
                      appearance="ghost"
                      role={current().multiple ? "checkbox" : "radio"}
                      aria-checked={answers()[active()]?.includes(option.label)}
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
                  value={custom()[active()] ?? ""}
                  onInput={(event) => setCustom((values) => values.map((value, index) => index === active() ? event.currentTarget.value : value))}
                  placeholder="Type a different answer"
                />
              </Show>
            </div>
          )}
        </Show>
      </div>

      <footer class="safety-card-actions question-actions">
        <Button appearance="ghost" tone="danger" leadingIcon="x" onClick={() => props.reject(props.request)}>Reject</Button>
        <span class="safety-action-spacer" />
        <Show when={active() > 0}><Button appearance="ghost" leadingIcon="chevronLeft" onClick={() => setActive((index) => index - 1)}>Back</Button></Show>
        <Button appearance="solid" tone="accent" trailingIcon={active() < last() ? "chevronRight" : "send"} disabled={active() < last() ? !currentValid() : !valid()} onClick={submitStep}>
          {active() < last() ? "Next" : "Reply"}
        </Button>
      </footer>
    </SurfaceCard>
  )
}
