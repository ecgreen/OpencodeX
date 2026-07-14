import type { TextareaRenderable } from "@opentui/core"
import type { QuestionAnswer, QuestionRequest } from "@opencode-ai/sdk/v2"
import { createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { useSDK } from "../../context/sdk"
import { useTuiConfig } from "../../context/tui-config"
import { useBindings, useOpencodeModeStack } from "../../keymap"
import { useToast } from "../../ui/toast"

const QUESTION_MODE = "question"

export function createQuestionController(props: { request: QuestionRequest }) {
  const sdk = useSDK()
  const toast = useToast()
  const tuiConfig = useTuiConfig()
  const modeStack = useOpencodeModeStack()
  const questions = createMemo(() => props.request.questions)
  const single = createMemo(() => questions().length === 1 && questions()[0]?.multiple !== true)
  const tabs = createMemo(() => (single() ? 1 : questions().length + 1))
  const [tabHover, setTabHover] = createSignal<number | "confirm" | null>(null)
  const [store, setStore] = createStore({
    tab: 0,
    answers: [] as QuestionAnswer[],
    custom: [] as string[],
    selected: 0,
    editing: false,
  })
  const question = createMemo(() => questions()[store.tab])
  const confirm = createMemo(() => !single() && store.tab === questions().length)
  const options = createMemo(() => question()?.options ?? [])
  const custom = createMemo(() => question()?.custom !== false)
  const other = createMemo(() => custom() && store.selected === options().length)
  const input = createMemo(() => store.custom[store.tab] ?? "")
  const multi = createMemo(() => question()?.multiple === true)
  const customPicked = createMemo(() => {
    if (!input()) return false
    return store.answers[store.tab]?.includes(input()) ?? false
  })
  let textarea: TextareaRenderable | undefined
  let active = true

  const reply = (answers: QuestionAnswer[]) => {
    void sdk.client.question.reply({ requestID: props.request.id, answers }).catch((error) => {
      toast.show({
        variant: "error",
        message: `Failed to answer question: ${error instanceof Error ? error.message : String(error)}`,
        duration: 4000,
      })
    })
  }

  const submit = () => reply(questions().map((_, index) => store.answers[index] ?? []))

  const reject = () => {
    void sdk.client.question.reject({ requestID: props.request.id }).catch((error) => {
      toast.show({
        variant: "error",
        message: `Failed to dismiss question: ${error instanceof Error ? error.message : String(error)}`,
        duration: 4000,
      })
    })
  }

  const toggle = (answer: string) => {
    const next = [...(store.answers[store.tab] ?? [])]
    const index = next.indexOf(answer)
    if (index === -1) next.push(answer)
    if (index !== -1) next.splice(index, 1)
    const answers = [...store.answers]
    answers[store.tab] = next
    setStore("answers", answers)
  }

  const pick = (answer: string, isCustom = false) => {
    const answers = [...store.answers]
    answers[store.tab] = [answer]
    setStore("answers", answers)
    if (isCustom) {
      const inputs = [...store.custom]
      inputs[store.tab] = answer
      setStore("custom", inputs)
    }
    if (single()) {
      reply([[answer]])
      return
    }
    selectTab(store.tab + 1)
  }

  const moveTo = (index: number) => setStore("selected", index)

  const moveSelection = (offset: number) => {
    const total = options().length + (custom() ? 1 : 0)
    if (total === 0) return
    moveTo((store.selected + offset + total) % total)
  }

  const selectTab = (index: number) => {
    setStore("tab", index)
    setStore("selected", 0)
  }

  const selectOption = () => {
    if (other()) {
      if (!multi()) {
        setStore("editing", true)
        return
      }
      if (input() && customPicked()) {
        toggle(input())
        return
      }
      setStore("editing", true)
      return
    }
    const option = options()[store.selected]
    if (!option) return
    if (multi()) {
      toggle(option.label)
      return
    }
    pick(option.label)
  }

  const attachTextarea = (value: TextareaRenderable) => {
    textarea = value
    value.traits = { status: "ANSWER" }
    queueMicrotask(() => {
      if (!active || textarea !== value) return
      value.focus()
      value.gotoLineEnd()
    })
  }

  onMount(() => {
    const popMode = modeStack.push(QUESTION_MODE)
    onCleanup(popMode)
  })
  onCleanup(() => {
    active = false
    textarea = undefined
  })

  useBindings(() => ({
    mode: QUESTION_MODE,
    enabled: store.editing && !confirm(),
    commands: [
      {
        name: "prompt.clear",
        title: "Clear answer edit",
        category: "Question",
        run() {
          if (textarea?.plainText) {
            textarea.setText("")
            return
          }
          setStore("editing", false)
        },
      },
    ],
    bindings: [
      { key: "escape", desc: "Cancel answer edit", group: "Question", cmd: () => setStore("editing", false) },
      ...tuiConfig.keybinds.get("prompt.clear"),
      {
        key: "return",
        desc: "Submit answer edit",
        group: "Question",
        cmd: () => commitCustomAnswer(),
      },
    ],
  }))

  useBindings(() => {
    const total = options().length + (custom() ? 1 : 0)
    const previousTab = () => selectTab((store.tab - 1 + tabs()) % tabs())
    const nextTab = () => selectTab((store.tab + 1) % tabs())
    return {
      mode: QUESTION_MODE,
      enabled: !store.editing,
      commands: [{ name: "app.exit", title: "Reject question", category: "Question", run: reject }],
      bindings: [
        { key: "left", desc: "Previous question", group: "Question", cmd: previousTab },
        { key: "h", desc: "Previous question", group: "Question", cmd: previousTab },
        { key: "right", desc: "Next question", group: "Question", cmd: nextTab },
        { key: "l", desc: "Next question", group: "Question", cmd: nextTab },
        {
          key: "tab",
          desc: "Next question",
          group: "Question",
          cmd: ({ event }: { event: { shift: boolean } }) =>
            selectTab((store.tab + (event.shift ? -1 : 1) + tabs()) % tabs()),
        },
        ...(confirm()
          ? [
              { key: "return", desc: "Submit answer", group: "Question", cmd: submit },
              { key: "escape", desc: "Reject question", group: "Question", cmd: reject },
              ...tuiConfig.keybinds.get("app.exit"),
            ]
          : [
              ...Array.from({ length: Math.min(total, 9) }, (_, index) => ({
                key: String(index + 1),
                desc: `Select answer ${index + 1}`,
                group: "Question",
                cmd: () => {
                  moveTo(index)
                  selectOption()
                },
              })),
              { key: "up", desc: "Previous answer", group: "Question", cmd: () => moveSelection(-1) },
              { key: "k", desc: "Previous answer", group: "Question", cmd: () => moveSelection(-1) },
              { key: "down", desc: "Next answer", group: "Question", cmd: () => moveSelection(1) },
              { key: "j", desc: "Next answer", group: "Question", cmd: () => moveSelection(1) },
              { key: "return", desc: "Select answer", group: "Question", cmd: selectOption },
              { key: "escape", desc: "Reject question", group: "Question", cmd: reject },
              ...tuiConfig.keybinds.get("app.exit"),
            ]),
      ],
    }
  })

  function commitCustomAnswer() {
    const text = textarea?.plainText?.trim() ?? ""
    const previous = store.custom[store.tab]
    if (!text) {
      if (previous) {
        const inputs = [...store.custom]
        inputs[store.tab] = ""
        setStore("custom", inputs)
        const answers = [...store.answers]
        answers[store.tab] = (answers[store.tab] ?? []).filter((answer) => answer !== previous)
        setStore("answers", answers)
      }
      setStore("editing", false)
      return
    }
    if (!multi()) {
      pick(text, true)
      setStore("editing", false)
      return
    }
    const inputs = [...store.custom]
    inputs[store.tab] = text
    setStore("custom", inputs)
    const next = [...(store.answers[store.tab] ?? [])].filter((answer) => answer !== previous)
    if (!next.includes(text)) next.push(text)
    const answers = [...store.answers]
    answers[store.tab] = next
    setStore("answers", answers)
    setStore("editing", false)
  }

  return {
    questions,
    single,
    tabHover,
    store,
    question,
    confirm,
    options,
    custom,
    other,
    input,
    multi,
    customPicked,
    setTabHover,
    selectTab,
    moveTo,
    selectOption,
    attachTextarea,
  }
}

export type QuestionController = ReturnType<typeof createQuestionController>
