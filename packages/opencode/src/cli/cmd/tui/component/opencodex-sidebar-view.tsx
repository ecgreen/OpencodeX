import { RGBA } from "@opentui/core"
import { For, Show } from "solid-js"
import { createOpencodeXSidebarController } from "./opencodex-sidebar-controller"
import { OpencodeXSidebarDashboard, OpencodeXSidebarRow } from "./opencodex-sidebar-rows"
import { OPENCODEX_SIDEBAR_WIDTH } from "./opencodex-sidebar-state"

const SIDEBAR_BACKGROUND = RGBA.fromInts(0, 0, 0, 255)

export function OpencodeXSidebar() {
  const controller = createOpencodeXSidebarController()
  return (
    <Show when={controller.open()}>
      <box
        backgroundColor={SIDEBAR_BACKGROUND}
        width={OPENCODEX_SIDEBAR_WIDTH}
        height="100%"
        flexDirection="column"
        border={["right"]}
        borderColor={controller.theme.border}
      >
        <OpencodeXSidebarDashboard controller={controller} />
        <scrollbox
          ref={controller.setScroll}
          flexGrow={1}
          minHeight={0}
          verticalScrollbarOptions={{ visible: false }}
        >
          <For each={controller.scrollRows()}>{(row) => <OpencodeXSidebarRow controller={controller} row={row} />}</For>
        </scrollbox>
        <box flexShrink={0} paddingTop={1} paddingBottom={1} paddingLeft={2} paddingRight={2} flexDirection="column">
          <text fg={controller.sidebarFocused() ? controller.theme.primary : controller.theme.textMuted}>
            {controller.sidebarFocused() ? "Esc" : controller.focusShortcut() || "Ctrl+X F"}{" "}
            {controller.sidebarFocused() ? "main panel" : "focus sidebar"}
          </text>
          <text fg={controller.theme.textMuted}>{controller.toggleShortcut() || "Ctrl+S"} toggle</text>
        </box>
      </box>
    </Show>
  )
}
