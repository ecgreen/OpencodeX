/** @jsxImportSource @opentui/solid */
import type { TextareaRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo } from "solid-js"
import { SplitBorder } from "../../component/border"
import { useTheme } from "../../context/theme"
import { useTuiConfig } from "../../context/tui-config"
import { OPENCODE_BASE_MODE, useBindings } from "../../keymap"

export function PermissionRejectPrompt(props: { onConfirm: (message: string) => void; onCancel: () => void }) {
  let input: TextareaRenderable
  const themeState = useTheme()
  const tuiConfig = useTuiConfig()
  const dimensions = useTerminalDimensions()
  const narrow = createMemo(() => dimensions().width < 80)
  useBindings(() => ({
    mode: OPENCODE_BASE_MODE,
    commands: [
      {
        name: "app.exit",
        title: "Cancel permission rejection",
        category: "Permission",
        run: props.onCancel,
      },
    ],
    bindings: [
      { key: "escape", desc: "Cancel permission rejection", group: "Permission", cmd: props.onCancel },
      ...tuiConfig.keybinds.get("app.exit"),
      {
        key: "return",
        desc: "Confirm permission rejection",
        group: "Permission",
        cmd: () => props.onConfirm(input.plainText),
      },
    ],
  }))

  return (
    <box
      backgroundColor={themeState.theme.backgroundPanel}
      border={["left"]}
      borderColor={themeState.theme.error}
      customBorderChars={SplitBorder.customBorderChars}
    >
      <box gap={1} paddingLeft={1} paddingRight={3} paddingTop={1} paddingBottom={1}>
        <box flexDirection="row" gap={1} paddingLeft={1}>
          <text fg={themeState.theme.error}>△</text>
          <text fg={themeState.theme.text}>Reject permission</text>
        </box>
        <box paddingLeft={1}>
          <text fg={themeState.theme.textMuted}>Tell OpenCode what to do differently</text>
        </box>
      </box>
      <box
        flexDirection={narrow() ? "column" : "row"}
        flexShrink={0}
        paddingTop={1}
        paddingLeft={2}
        paddingRight={3}
        paddingBottom={1}
        backgroundColor={themeState.theme.backgroundElement}
        justifyContent={narrow() ? "flex-start" : "space-between"}
        alignItems={narrow() ? "flex-start" : "center"}
        gap={1}
      >
        <textarea
          ref={(value: TextareaRenderable) => {
            input = value
            value.traits = { status: "REJECT" }
          }}
          focused
          textColor={themeState.theme.text}
          focusedTextColor={themeState.theme.text}
          cursorColor={themeState.theme.primary}
        />
        <box flexDirection="row" gap={2} flexShrink={0}>
          <text fg={themeState.theme.text}>
            enter <span style={{ fg: themeState.theme.textMuted }}>confirm</span>
          </text>
          <text fg={themeState.theme.text}>
            esc <span style={{ fg: themeState.theme.textMuted }}>cancel</span>
          </text>
        </box>
      </box>
    </box>
  )
}
