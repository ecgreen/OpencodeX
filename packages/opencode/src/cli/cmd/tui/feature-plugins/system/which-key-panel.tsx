/** @jsxImportSource @opentui/solid */
import { TextAttributes } from "@opentui/core"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { createMemo, For, Show } from "solid-js"
import { createWhichKeyController, useWhichKeyShortcut } from "./which-key-controller"
import {
  whichKeyCommand,
  whichKeySkin,
  WHICH_KEY_COLUMN_GAP,
  WHICH_KEY_FOOTER_MARGIN,
  WHICH_KEY_TAB_CONTENT_GAP,
  type WhichKeyEntry,
  type WhichKeyLayout,
} from "./which-key-model"

export function WhichKeyHomeHint(props: { api: TuiPluginApi }) {
  const trigger = useWhichKeyShortcut(props.api, whichKeyCommand.toggle)
  const look = createMemo(() => whichKeySkin(props.api))
  return (
    <box width="100%" maxWidth={75} alignItems="center" paddingTop={1} flexShrink={0}>
      <text fg={look().muted} wrapMode="none">
        Show keyboard shortcuts with <span style={{ fg: look().subtle }}>{trigger() || whichKeyCommand.toggle}</span>
      </text>
    </box>
  )
}

export function WhichKeyPanel(props: {
  api: TuiPluginApi
  layout: WhichKeyLayout
  mode: () => WhichKeyLayout
  pendingPreview: () => boolean
  pinned: () => boolean
}) {
  const controller = createWhichKeyController(props)
  return (
    <Show when={controller.visible()}>
      <box
        position={props.layout === "overlay" ? "absolute" : "relative"}
        zIndex={3500}
        left={0}
        bottom={props.layout === "overlay" ? 0 : undefined}
        width={controller.dimensions().width}
        height={controller.panelHeight()}
        backgroundColor={controller.look().panel}
        paddingLeft={1}
        paddingRight={1}
        paddingTop={1}
        flexShrink={0}
        flexDirection="column"
      >
        <Show when={controller.headerVisible()}>
          <box width="100%" flexDirection="row" justifyContent="center" gap={controller.tabGap()} flexShrink={0}>
            <For each={controller.headerItems()}>
              {(item) => (
                <Show
                  when={item.type === "tab" ? item.group : undefined}
                  fallback={
                    <box flexShrink={0}>
                      <text wrapMode="none">
                        <span style={{ fg: controller.upActive() ? controller.look().text : controller.look().muted }}>↑</span>
                        <span style={{ fg: controller.look().muted }}> </span>
                        <span style={{ fg: controller.downActive() ? controller.look().text : controller.look().muted }}>↓</span>
                      </text>
                    </box>
                  }
                >
                  {(group) => {
                    const selected = createMemo(() => controller.currentGroup()?.label === group().label)
                    return (
                      <box
                        paddingLeft={1}
                        paddingRight={1}
                        flexShrink={0}
                        backgroundColor={selected() ? controller.look().tab : undefined}
                        onMouseDown={() => {
                          controller.setActiveGroup(group().label)
                          controller.setOffset(0)
                        }}
                      >
                        <text
                          fg={selected() ? controller.look().tabText : controller.look().muted}
                          attributes={selected() ? TextAttributes.BOLD : undefined}
                          wrapMode="none"
                        >
                          {group().label}
                        </text>
                      </box>
                    )
                  }}
                </Show>
              )}
            </For>
          </box>
        </Show>
        <Show when={controller.tabsVisible()}>
          <box height={WHICH_KEY_TAB_CONTENT_GAP} flexShrink={0} />
        </Show>
        <box height={controller.rows()} flexShrink={0} flexDirection="column">
          <Show when={controller.shown().length} fallback={<text fg={controller.look().muted}>No reachable bindings</text>}>
            <For each={controller.rowIndexes()}>
              {(row) => (
                <box width="100%" flexDirection="row" justifyContent="center" gap={WHICH_KEY_COLUMN_GAP}>
                  <For each={controller.shown()}>
                    {(column) => {
                      const item = createMemo(() => column[row])
                      const entry = createMemo<WhichKeyEntry | undefined>(() => {
                        const value = item()
                        return value?.type === "entry" ? value : undefined
                      })
                      return (
                        <box width={controller.columnWidth()} flexDirection="row" gap={1} justifyContent="space-between">
                          <Show when={item()}>
                            {(value) => (
                              <Show
                                when={entry()}
                                fallback={
                                  <text fg={controller.look().accent} attributes={TextAttributes.BOLD} wrapMode="none" truncate>
                                    {value().label}
                                  </text>
                                }
                              >
                                {(binding) => (
                                  <>
                                    <box flexGrow={1} minWidth={0}>
                                      <text
                                        fg={binding().continues ? controller.look().accent : controller.look().muted}
                                        wrapMode="none"
                                        truncate
                                      >
                                        {binding().label}
                                      </text>
                                    </box>
                                    <box flexShrink={0}>
                                      <text fg={controller.look().text} attributes={TextAttributes.BOLD} wrapMode="none" truncate>
                                        {binding().key}
                                      </text>
                                    </box>
                                  </>
                                )}
                              </Show>
                            )}
                          </Show>
                        </box>
                      )
                    }}
                  </For>
                </box>
              )}
            </For>
          </Show>
        </box>
        <Show when={controller.footerVisible()}>
          <box height={WHICH_KEY_FOOTER_MARGIN} flexShrink={0} />
          <box width="100%" flexDirection="row" justifyContent="space-between" flexShrink={0}>
            <text fg={controller.look().text} wrapMode="none">
              toggle <span style={{ fg: controller.look().subtle }}>{controller.trigger() || whichKeyCommand.toggle}</span>
            </text>
            <text fg={controller.look().text} wrapMode="none">
              {controller.nextMode()} <span style={{ fg: controller.look().subtle }}>{controller.modeTrigger() || whichKeyCommand.toggleLayout}</span>
            </text>
          </box>
        </Show>
      </box>
    </Show>
  )
}
