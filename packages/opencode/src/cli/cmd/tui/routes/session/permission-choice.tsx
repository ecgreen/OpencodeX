/** @jsxImportSource @opentui/solid */
import { Portal, useRenderer, useTerminalDimensions, type JSX } from "@opentui/solid"
import { createMemo, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { SplitBorder } from "../../component/border"
import { selectedForeground, useTheme } from "../../context/theme"
import { useTuiConfig } from "../../context/tui-config"
import { OPENCODE_BASE_MODE, useBindings, useCommandShortcut } from "../../keymap"

export function PermissionChoicePrompt<const T extends Record<string, string>>(props: {
  title: string
  header?: JSX.Element
  body: JSX.Element
  options: T
  escapeKey?: keyof T
  fullscreen?: boolean
  onSelect: (option: keyof T) => void
}) {
  const themeState = useTheme()
  const tuiConfig = useTuiConfig()
  const dimensions = useTerminalDimensions()
  const keys = Object.keys(props.options) as (keyof T)[]
  const [store, setStore] = createStore({ selected: keys[0], expanded: false })
  const narrow = createMemo(() => dimensions().width < 80)
  const fullscreenHint = useCommandShortcut("permission.prompt.fullscreen")
  const moveSelection = (offset: number) => {
    const index = keys.indexOf(store.selected)
    setStore("selected", keys[(index + offset + keys.length) % keys.length])
  }

  useBindings(() => ({
    mode: OPENCODE_BASE_MODE,
    commands: [
      {
        name: "app.exit",
        title: "Reject permission",
        category: "Permission",
        run() {
          if (props.escapeKey) props.onSelect(props.escapeKey)
        },
      },
      {
        name: "permission.prompt.fullscreen",
        title: "Toggle permission fullscreen",
        category: "Permission",
        run() {
          if (props.fullscreen) setStore("expanded", (value) => !value)
        },
      },
    ],
    bindings: [
      { key: "left", desc: "Previous permission option", group: "Permission", cmd: () => moveSelection(-1) },
      { key: "h", desc: "Previous permission option", group: "Permission", cmd: () => moveSelection(-1) },
      { key: "right", desc: "Next permission option", group: "Permission", cmd: () => moveSelection(1) },
      { key: "l", desc: "Next permission option", group: "Permission", cmd: () => moveSelection(1) },
      {
        key: "return",
        desc: "Select permission option",
        group: "Permission",
        cmd: () => props.onSelect(store.selected),
      },
      ...(props.escapeKey
        ? [
            {
              key: "escape",
              desc: "Reject permission",
              group: "Permission",
              cmd: () => props.onSelect(props.escapeKey!),
            },
          ]
        : []),
      ...(props.escapeKey ? tuiConfig.keybinds.get("app.exit") : []),
      ...(props.fullscreen ? tuiConfig.keybinds.get("permission.prompt.fullscreen") : []),
    ],
  }))

  useRenderer()
  const content = () => (
    <box
      backgroundColor={themeState.theme.backgroundPanel}
      border={["left"]}
      borderColor={themeState.theme.warning}
      customBorderChars={SplitBorder.customBorderChars}
      {...(store.expanded
        ? { top: dimensions().height * -1 + 1, bottom: 1, left: 2, right: 2, position: "absolute" as const }
        : { top: 0, maxHeight: 15, bottom: 0, left: 0, right: 0, position: "relative" as const })}
    >
      <box gap={1} paddingLeft={1} paddingRight={3} paddingTop={1} paddingBottom={1} flexGrow={1}>
        <Show
          when={props.header}
          fallback={
            <box flexDirection="row" gap={1} paddingLeft={1} flexShrink={0}>
              <text fg={themeState.theme.warning}>△</text>
              <text fg={themeState.theme.text}>{props.title}</text>
            </box>
          }
        >
          <box paddingLeft={1} flexShrink={0}>
            {props.header}
          </box>
        </Show>
        {props.body}
      </box>
      <box
        flexDirection={narrow() ? "column" : "row"}
        flexShrink={0}
        gap={1}
        paddingTop={1}
        paddingLeft={2}
        paddingRight={3}
        paddingBottom={1}
        backgroundColor={themeState.theme.backgroundElement}
        justifyContent={narrow() ? "flex-start" : "space-between"}
        alignItems={narrow() ? "flex-start" : "center"}
      >
        <box flexDirection="row" gap={1} flexShrink={0}>
          <For each={keys}>
            {(option) => (
              <box
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={option === store.selected ? themeState.theme.warning : themeState.theme.backgroundMenu}
                onMouseOver={() => setStore("selected", option)}
                onMouseUp={() => {
                  setStore("selected", option)
                  props.onSelect(option)
                }}
              >
                <text
                  fg={
                    option === store.selected
                      ? selectedForeground(themeState.theme, themeState.theme.warning)
                      : themeState.theme.textMuted
                  }
                >
                  {props.options[option]}
                </text>
              </box>
            )}
          </For>
        </box>
        <box flexDirection="row" gap={2} flexShrink={0}>
          <Show when={props.fullscreen}>
            <text fg={themeState.theme.text}>
              {fullscreenHint()} <span style={{ fg: themeState.theme.textMuted }}>{store.expanded ? "minimize" : "fullscreen"}</span>
            </text>
          </Show>
          <text fg={themeState.theme.text}>
            ⇆ <span style={{ fg: themeState.theme.textMuted }}>select</span>
          </text>
          <text fg={themeState.theme.text}>
            enter <span style={{ fg: themeState.theme.textMuted }}>confirm</span>
          </text>
        </box>
      </box>
    </box>
  )

  return (
    <Show when={!store.expanded} fallback={<Portal>{content()}</Portal>}>
      {content()}
    </Show>
  )
}
