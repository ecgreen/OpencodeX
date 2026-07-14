/** @jsxImportSource @opentui/solid */
import { RGBA, TextAttributes, type InputRenderable, type ScrollBoxRenderable } from "@opentui/core"
import { isDeepEqual } from "remeda"
import { createMemo, For, Show } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { Locale } from "@/util/locale"
import { useDialog } from "./dialog"
import { createDialogSelectController } from "./dialog-select-controller"
import { DialogSelectOptionRow } from "./dialog-select-option"
import type { DialogSelectProps } from "./dialog-select-types"

export function DialogSelect<T>(props: DialogSelectProps<T>) {
  const dialog = useDialog()
  const themeState = useTheme()
  const controller = createDialogSelectController(props, dialog)

  return (
    <box gap={1} paddingBottom={1} flexGrow={1}>
      <box paddingLeft={4} paddingRight={4}>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={themeState.theme.text} attributes={TextAttributes.BOLD}>
            {props.title}
          </text>
          <text fg={themeState.theme.textMuted} onMouseUp={() => dialog.clear()}>
            esc
          </text>
        </box>
        <Show when={props.renderFilter !== false}>
          <box paddingTop={1}>
            <input
              onInput={controller.onFilter}
              focusedBackgroundColor={themeState.theme.backgroundPanel}
              cursorColor={themeState.theme.primary}
              focusedTextColor={themeState.theme.textMuted}
              ref={(input: InputRenderable) => controller.focusInput(input)}
              placeholder={props.placeholder ?? "Search"}
              placeholderColor={themeState.theme.textMuted}
            />
          </box>
        </Show>
      </box>
      <box flexGrow={1} flexShrink={1}>
        <Show
          when={controller.grouped().length}
          fallback={
            <box paddingLeft={4} paddingRight={4} paddingTop={1}>
              <text fg={themeState.theme.textMuted}>No results found</text>
            </box>
          }
        >
          <scrollbox
            paddingLeft={1}
            paddingRight={1}
            scrollbarOptions={{ visible: false }}
            scrollAcceleration={controller.scrollAcceleration()}
            ref={(scroll: ScrollBoxRenderable) => controller.setScroll(scroll)}
            maxHeight={controller.height()}
          >
            <For each={controller.grouped()}>
              {([category, options], groupIndex) => (
                <>
                  <Show when={category}>
                    <box paddingTop={groupIndex() > 0 ? 1 : 0} paddingLeft={3}>
                      <Show
                        when={options[0]?.categoryView}
                        fallback={
                          <text fg={themeState.theme.accent} attributes={TextAttributes.BOLD}>
                            {category}
                          </text>
                        }
                      >
                        {options[0]?.categoryView}
                      </Show>
                    </box>
                  </Show>
                  <For each={options}>
                    {(option) => {
                      const active = createMemo(() => isDeepEqual(option.value, controller.selected()?.value))
                      const current = createMemo(() => isDeepEqual(option.value, props.current))
                      return (
                        <box
                          id={controller.optionID(option)}
                          flexDirection="column"
                          position="relative"
                          onMouseMove={() => controller.setInputMode("mouse")}
                          onMouseUp={() => controller.selectOption(option)}
                          onMouseOver={() => {
                            if (controller.store.input !== "mouse") return
                            const index = controller.optionIndex(option)
                            if (index >= 0) controller.moveTo(index)
                          }}
                          onMouseDown={() => {
                            const index = controller.optionIndex(option)
                            if (index >= 0) controller.moveTo(index)
                          }}
                        >
                          <box
                            flexDirection="row"
                            paddingLeft={current() || option.gutter ? 1 : 3}
                            paddingRight={3}
                            gap={1}
                            backgroundColor={active() ? (option.bg ?? themeState.theme.primary) : RGBA.fromInts(0, 0, 0, 0)}
                          >
                            <Show when={!current() && option.margin}>
                              <box position="absolute" left={1} flexShrink={0}>
                                {option.margin}
                              </box>
                            </Show>
                            <DialogSelectOptionRow
                              title={option.title}
                              footer={controller.flatten() ? (option.category ?? option.footer) : option.footer}
                              description={option.description !== category ? option.description : undefined}
                              active={active()}
                              current={current()}
                              gutter={option.gutter}
                            />
                          </box>
                          <For each={option.details}>
                            {(detail) => (
                              <box paddingLeft={3} paddingRight={3}>
                                <text fg={themeState.theme.textMuted} wrapMode="none">
                                  {Locale.truncateMiddle(
                                    detail,
                                    Math.max(1, Math.min(76, controller.dimensions().width - 12)),
                                  )}
                                </text>
                              </box>
                            )}
                          </For>
                        </box>
                      )
                    }}
                  </For>
                </>
              )}
            </For>
          </scrollbox>
        </Show>
      </box>
      <Show when={controller.visibleActions().length} fallback={<box flexShrink={0} />}>
        <box
          paddingRight={2}
          paddingLeft={4}
          flexDirection="row"
          justifyContent="space-between"
          flexShrink={0}
          paddingTop={1}
        >
          <DialogSelectHints items={controller.left()} />
          <DialogSelectHints items={controller.right()} />
        </box>
      </Show>
    </box>
  )
}

function DialogSelectHints(props: { items: Array<{ title: string; label: string }> }) {
  const themeState = useTheme()
  return (
    <box flexDirection="row" gap={2}>
      <For each={props.items}>
        {(item) => (
          <text>
            <span style={{ fg: themeState.theme.text }}>
              <b>{item.title}</b>{" "}
            </span>
            <span style={{ fg: themeState.theme.textMuted }}>{item.label}</span>
          </text>
        )}
      </For>
    </box>
  )
}

export type { DialogSelectOption, DialogSelectProps, DialogSelectRef } from "./dialog-select-types"
