import type { PermissionRequest, QuestionAnswer, QuestionRequest } from "@opencode-ai/sdk/v2/client"
import { For, Show, createMemo, createSignal } from "solid-js"
import { File as FileDiffView } from "@opencode-ai/ui/file"
import {
  collapseOutput,
  patchContents,
  permissionDiff,
  permissionTitle,
  stringValue,
  toolError,
  toolInput,
  toolOutput,
} from "../lib/tool-display"
import { Icon } from "./icon"
import type { ToolPart } from "./session-transcript"

export function PermissionPanel(props: { request: PermissionRequest; tool?: ToolPart; reply: (request: PermissionRequest, reply: "once" | "always" | "reject") => void }) {
  const input = () => toolInput(props.request, props.tool)
  const [expanded, setExpanded] = createSignal(false)
  const choose = (reply: "once" | "always" | "reject") => props.reply(props.request, reply)
  return (
    <section
      class="safety-panel permission-panel"
      classList={{ expanded: expanded() }}
      tabindex="0"
      onKeyDown={(event) => {
        if (event.key === "1") choose("once")
        if (event.key === "2") choose("always")
        if (event.key === "3" || event.key === "Escape") choose("reject")
        if (event.key.toLowerCase() === "f") setExpanded((value) => !value)
      }}
    >
      <div>
        <p class="eyebrow">Permission Required</p>
        <h2>{permissionTitle(props.request, input())}</h2>
        <Show when={props.request.patterns.length > 0}>
          <p>Patterns: {props.request.patterns.join(", ")}</p>
        </Show>
        <Show when={props.tool}>
          {(tool) => (
            <details class="permission-context" open>
              <summary>Tool Context: {tool().tool}</summary>
              <Show when={Object.keys(input()).length > 0}>
                <pre>{JSON.stringify(input(), null, 2)}</pre>
              </Show>
              <Show when={toolOutput(tool().state)}>
                {(output) => <pre>{collapseOutput(output()).output}</pre>}
              </Show>
              <Show when={toolError(tool().state)}>
                {(error) => <pre>{error()}</pre>}
              </Show>
            </details>
          )}
        </Show>
        <Show when={permissionDiff(props.request)}>
          {(diff) => (
            <details class="permission-context" open>
              <summary>Requested Diff</summary>
              <PermissionDiff diff={diff()} filePath={stringValue(props.request.metadata.filepath)} />
            </details>
          )}
        </Show>
        <Show when={Object.keys(props.request.metadata).length > 0}>
          <details class="permission-context">
            <summary>Raw Metadata</summary>
            <pre>{JSON.stringify(props.request.metadata, null, 2)}</pre>
          </details>
        </Show>
      </div>
      <div class="safety-actions">
        <button class="secondary" onClick={() => setExpanded((value) => !value)}><Icon name={expanded() ? "chevronRight" : "chevronDown"} /> {expanded() ? "Collapse" : "Expand"}</button>
        <button class="secondary danger" onClick={() => choose("reject")}><Icon name="x" /> Reject</button>
        <button class="secondary" onClick={() => choose("once")}><Icon name="check" /> Allow Once</button>
        <button class="primary" onClick={() => choose("always")}><Icon name="check" /> Always Allow</button>
      </div>
    </section>
  )
}

export function QuestionPanel(props: { request: QuestionRequest; reply: (request: QuestionRequest, answers: QuestionAnswer[]) => void; reject: (request: QuestionRequest) => void }) {
  const [answers, setAnswers] = createSignal<QuestionAnswer[]>(props.request.questions.map(() => []))
  const [custom, setCustom] = createSignal<string[]>(props.request.questions.map(() => ""))
  const [active, setActive] = createSignal(0)
  const finalAnswers = () =>
    answers().map((answer, index) => {
      const text = custom()[index]?.trim()
      if (!text) return answer
      return [...answer, text]
    })
  const valid = () => finalAnswers().every((answer) => answer.length > 0)
  function toggle(index: number, label: string, multiple?: boolean) {
    setAnswers((current) =>
      current.map((answer, i) => {
        if (i !== index) return answer
        if (!multiple) return [label]
        if (answer.includes(label)) return answer.filter((item) => item !== label)
        return [...answer, label]
      }),
    )
  }
  function choose(index: number, label: string, multiple?: boolean) {
    toggle(index, label, multiple)
    if (props.request.questions.length === 1 && !multiple) props.reply(props.request, [[label]])
    else setActive((current) => Math.min(props.request.questions.length - 1, current + 1))
  }
  function updateCustom(index: number, value: string) {
    setCustom((current) => current.map((item, i) => (i === index ? value : item)))
  }
  return (
    <section
      class="safety-panel question-panel"
      tabindex="0"
      onKeyDown={(event) => {
        if (event.key === "Escape") props.reject(props.request)
        if (event.key === "Tab") {
          event.preventDefault()
          setActive((current) => (current + (event.shiftKey ? -1 : 1) + props.request.questions.length) % props.request.questions.length)
        }
        const option = Number(event.key)
        if (option >= 1 && option <= 9) {
          const question = props.request.questions[active()]
          const selected = question?.options[option - 1]
          if (question && selected) choose(active(), selected.label, question.multiple)
        }
      }}
    >
      <div>
        <p class="eyebrow">Question Pending</p>
        <For each={props.request.questions}>
          {(question, index) => (
            <div class="question-block" classList={{ active: active() === index() }}>
              <h2>{question.header}</h2>
              <p>{question.question}</p>
              <div class="option-list">
                <For each={question.options}>
                  {(option, optionIndex) => (
                    <button
                      classList={{ selected: answers()[index()].includes(option.label) }}
                      onClick={() => choose(index(), option.label, question.multiple)}
                    >
                      <strong>{optionIndex() + 1}. {option.label}</strong>
                      <span>{option.description}</span>
                    </button>
                  )}
                </For>
              </div>
              <Show when={question.custom !== false}>
                <input
                  class="custom-answer"
                  value={custom()[index()] ?? ""}
                  onInput={(event) => updateCustom(index(), event.currentTarget.value)}
                  placeholder="Type a custom answer"
                />
              </Show>
            </div>
          )}
        </For>
      </div>
      <div class="safety-actions">
        <button class="secondary danger" onClick={() => props.reject(props.request)}><Icon name="x" /> Reject</button>
        <button class="primary" disabled={!valid()} onClick={() => props.reply(props.request, finalAnswers())}><Icon name="send" /> Reply</button>
      </div>
    </section>
  )
}

function PermissionDiff(props: { diff: string; filePath?: string }) {
  const contents = createMemo(() => patchContents(props.diff, props.filePath ?? "diff"))
  return (
    <Show when={contents()} fallback={<pre>{props.diff}</pre>}>
      {(value) => (
        <div class="permission-diff">
          <FileDiffView mode="diff" before={value().before} after={value().after} diffStyle="split" virtualize={false} hunkSeparators="simple" />
        </div>
      )}
    </Show>
  )
}
