import type { TextareaRenderable } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { For, Show } from "solid-js"
import { SplitBorder } from "../../component/border"
import { selectedForeground, tint, useTheme } from "../../context/theme"
import type { QuestionController } from "./question-controller"

export function QuestionPromptView(props: { controller: QuestionController }) {
  const themeState = useTheme()
  return (
    <box
      backgroundColor={themeState.theme.backgroundPanel}
      border={["left"]}
      borderColor={themeState.theme.accent}
      customBorderChars={SplitBorder.customBorderChars}
    >
      <box gap={1} paddingLeft={1} paddingRight={3} paddingTop={1} paddingBottom={1}>
        <QuestionTabs controller={props.controller} />
        <QuestionOptions controller={props.controller} />
        <QuestionReview controller={props.controller} />
      </box>
      <QuestionFooter controller={props.controller} />
    </box>
  )
}

function QuestionTabs(props: { controller: QuestionController }) {
  const themeState = useTheme()
  const renderer = useRenderer()
  return (
    <Show when={!props.controller.single()}>
      <box flexDirection="row" gap={1} paddingLeft={1}>
        <For each={props.controller.questions()}>
          {(question, index) => {
            const active = () => index() === props.controller.store.tab
            const answered = () => (props.controller.store.answers[index()]?.length ?? 0) > 0
            return (
              <box
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={
                  active()
                    ? themeState.theme.accent
                    : props.controller.tabHover() === index()
                      ? themeState.theme.backgroundElement
                      : themeState.theme.backgroundPanel
                }
                onMouseOver={() => props.controller.setTabHover(index())}
                onMouseOut={() => props.controller.setTabHover(null)}
                onMouseUp={() => {
                  if (renderer.getSelection()?.getSelectedText()) return
                  props.controller.selectTab(index())
                }}
              >
                <text
                  fg={
                    active()
                      ? selectedForeground(themeState.theme, themeState.theme.accent)
                      : answered()
                        ? themeState.theme.text
                        : themeState.theme.textMuted
                  }
                >
                  {question.header}
                </text>
              </box>
            )
          }}
        </For>
        <box
          paddingLeft={1}
          paddingRight={1}
          backgroundColor={
            props.controller.confirm()
              ? themeState.theme.accent
              : props.controller.tabHover() === "confirm"
                ? themeState.theme.backgroundElement
                : themeState.theme.backgroundPanel
          }
          onMouseOver={() => props.controller.setTabHover("confirm")}
          onMouseOut={() => props.controller.setTabHover(null)}
          onMouseUp={() => {
            if (renderer.getSelection()?.getSelectedText()) return
            props.controller.selectTab(props.controller.questions().length)
          }}
        >
          <text
            fg={
              props.controller.confirm()
                ? selectedForeground(themeState.theme, themeState.theme.accent)
                : themeState.theme.textMuted
            }
          >
            Confirm
          </text>
        </box>
      </box>
    </Show>
  )
}

function QuestionOptions(props: { controller: QuestionController }) {
  const themeState = useTheme()
  const renderer = useRenderer()
  return (
    <Show when={!props.controller.confirm()}>
      <box paddingLeft={1} gap={1}>
        <text fg={themeState.theme.text}>
          {props.controller.question()?.question}
          {props.controller.multi() ? " (select all that apply)" : ""}
        </text>
        <box>
          <For each={props.controller.options()}>
            {(option, index) => {
              const active = () => index() === props.controller.store.selected
              const picked = () => props.controller.store.answers[props.controller.store.tab]?.includes(option.label) ?? false
              return (
                <box
                  onMouseOver={() => props.controller.moveTo(index())}
                  onMouseDown={() => props.controller.moveTo(index())}
                  onMouseUp={() => {
                    if (renderer.getSelection()?.getSelectedText()) return
                    props.controller.selectOption()
                  }}
                >
                  <box flexDirection="row">
                    <box backgroundColor={active() ? themeState.theme.backgroundElement : undefined} paddingRight={1}>
                      <text
                        fg={
                          active()
                            ? tint(themeState.theme.textMuted, themeState.theme.secondary, 0.6)
                            : themeState.theme.textMuted
                        }
                      >
                        {`${index() + 1}.`}
                      </text>
                    </box>
                    <box backgroundColor={active() ? themeState.theme.backgroundElement : undefined}>
                      <text
                        fg={active() ? themeState.theme.secondary : picked() ? themeState.theme.success : themeState.theme.text}
                      >
                        {props.controller.multi() ? `[${picked() ? "✓" : " "}] ${option.label}` : option.label}
                      </text>
                    </box>
                    <Show when={!props.controller.multi()}>
                      <text fg={themeState.theme.success}>{picked() ? " ✓" : ""}</text>
                    </Show>
                  </box>
                  <box paddingLeft={3}>
                    <text fg={themeState.theme.textMuted}>{option.description}</text>
                  </box>
                </box>
              )
            }}
          </For>
          <CustomAnswer controller={props.controller} />
        </box>
      </box>
    </Show>
  )
}

function CustomAnswer(props: { controller: QuestionController }) {
  const themeState = useTheme()
  const renderer = useRenderer()
  return (
    <Show when={props.controller.custom()}>
      <box
        onMouseOver={() => props.controller.moveTo(props.controller.options().length)}
        onMouseDown={() => props.controller.moveTo(props.controller.options().length)}
        onMouseUp={() => {
          if (renderer.getSelection()?.getSelectedText()) return
          props.controller.selectOption()
        }}
      >
        <box flexDirection="row">
          <box backgroundColor={props.controller.other() ? themeState.theme.backgroundElement : undefined} paddingRight={1}>
            <text
              fg={
                props.controller.other()
                  ? tint(themeState.theme.textMuted, themeState.theme.secondary, 0.6)
                  : themeState.theme.textMuted
              }
            >
              {`${props.controller.options().length + 1}.`}
            </text>
          </box>
          <box backgroundColor={props.controller.other() ? themeState.theme.backgroundElement : undefined}>
            <text
              fg={
                props.controller.other()
                  ? themeState.theme.secondary
                  : props.controller.customPicked()
                    ? themeState.theme.success
                    : themeState.theme.text
              }
            >
              {props.controller.multi()
                ? `[${props.controller.customPicked() ? "✓" : " "}] Type your own answer`
                : "Type your own answer"}
            </text>
          </box>
          <Show when={!props.controller.multi()}>
            <text fg={themeState.theme.success}>{props.controller.customPicked() ? " ✓" : ""}</text>
          </Show>
        </box>
        <Show when={props.controller.store.editing}>
          <box paddingLeft={3}>
            <textarea
              ref={(value: TextareaRenderable) => props.controller.attachTextarea(value)}
              initialValue={props.controller.input()}
              placeholder="Type your own answer"
              placeholderColor={themeState.theme.textMuted}
              minHeight={1}
              maxHeight={6}
              textColor={themeState.theme.text}
              focusedTextColor={themeState.theme.text}
              cursorColor={themeState.theme.primary}
            />
          </box>
        </Show>
        <Show when={!props.controller.store.editing && props.controller.input()}>
          <box paddingLeft={3}>
            <text fg={themeState.theme.textMuted}>{props.controller.input()}</text>
          </box>
        </Show>
      </box>
    </Show>
  )
}

function QuestionReview(props: { controller: QuestionController }) {
  const themeState = useTheme()
  return (
    <Show when={props.controller.confirm() && !props.controller.single()}>
      <box paddingLeft={1}>
        <text fg={themeState.theme.text}>Review</text>
      </box>
      <For each={props.controller.questions()}>
        {(question, index) => {
          const answer = () => props.controller.store.answers[index()]?.join(", ") ?? ""
          return (
            <box paddingLeft={1}>
              <text>
                <span style={{ fg: themeState.theme.textMuted }}>{question.header}:</span>{" "}
                <span style={{ fg: answer() ? themeState.theme.text : themeState.theme.error }}>
                  {answer() || "(not answered)"}
                </span>
              </text>
            </box>
          )
        }}
      </For>
    </Show>
  )
}

function QuestionFooter(props: { controller: QuestionController }) {
  const themeState = useTheme()
  return (
    <box
      flexDirection="row"
      flexShrink={0}
      gap={1}
      paddingLeft={2}
      paddingRight={3}
      paddingBottom={1}
      justifyContent="space-between"
    >
      <box flexDirection="row" gap={2}>
        <Show when={!props.controller.single()}>
          <text fg={themeState.theme.text}>
            ⇆ <span style={{ fg: themeState.theme.textMuted }}>tab</span>
          </text>
        </Show>
        <Show when={!props.controller.confirm()}>
          <text fg={themeState.theme.text}>
            ↑↓ <span style={{ fg: themeState.theme.textMuted }}>select</span>
          </text>
        </Show>
        <text fg={themeState.theme.text}>
          enter{" "}
          <span style={{ fg: themeState.theme.textMuted }}>
            {props.controller.confirm()
              ? "submit"
              : props.controller.multi()
                ? "toggle"
                : props.controller.single()
                  ? "submit"
                  : "confirm"}
          </span>
        </text>
        <text fg={themeState.theme.text}>
          esc <span style={{ fg: themeState.theme.textMuted }}>dismiss</span>
        </text>
      </box>
    </box>
  )
}
