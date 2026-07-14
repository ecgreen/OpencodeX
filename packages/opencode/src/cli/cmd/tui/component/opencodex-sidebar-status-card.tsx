import { TextAttributes, type RGBA } from "@opentui/core"
import { createColors, createFrames } from "@tui/ui/spinner"
import "opentui-spinner/solid"
import { createMemo, Show } from "solid-js"
import { LogoShimmerText } from "./logo"
import type { createOpencodeXSidebarController } from "./opencodex-sidebar-controller"
import { titleLabel } from "./opencodex-sidebar-model"
import { createOpencodeXSidebarRowStyle } from "./opencodex-sidebar-row-style"

export const SIDEBAR_CARD_TITLE_WIDTH = 25
export const SIDEBAR_CARD_DETAIL_WIDTH = 25
export const SIDEBAR_CARD_PROGRESS_DETAIL_WIDTH = 21

export function OpencodeXSidebarStatusCard(props: {
  controller: ReturnType<typeof createOpencodeXSidebarController>
  rowID: string
  active: boolean
  title: string
  titleColor: RGBA
  borderColor: RGBA
  animateTitle: boolean
  detail: string
  progress: boolean
  progressColor: RGBA
  progressWidth: number
  statusText?: string
  onOpen(): void
}) {
  const style = createOpencodeXSidebarRowStyle(props.controller)
  const animationsEnabled = createMemo(() => props.controller.kv.get("animations_enabled", true))
  const spinner = createMemo(() => ({
    frames: createFrames({
      color: props.progressColor,
      width: props.progressWidth,
      style: "diamonds",
      inactiveFactor: 0.5,
      minAlpha: 0.3,
    }),
    color: createColors({
      color: props.progressColor,
      width: props.progressWidth,
      style: "diamonds",
      inactiveFactor: 0.5,
      minAlpha: 0.3,
    }),
  }))

  return (
    <box
      id={props.rowID}
      flexShrink={0}
      marginBottom={1}
      marginLeft={1}
      marginRight={1}
      flexDirection="column"
      backgroundColor={style.cardBackground(props.rowID, props.active)}
      onMouseUp={() => {
        props.controller.setSelectedRowID(props.rowID)
        props.onOpen()
      }}
    >
      <box flexDirection="column" border={["left"]} borderColor={props.borderColor}>
        <box height={1} paddingLeft={1} paddingRight={1} flexDirection="row" gap={1} alignItems="center">
          <Show
            when={animationsEnabled() && props.animateTitle}
            fallback={
              <text
                attributes={TextAttributes.BOLD}
                fg={style.textColor(props.rowID, props.titleColor)}
                overflow="hidden"
                wrapMode="none"
                truncate
              >
                {titleLabel(props.title, SIDEBAR_CARD_TITLE_WIDTH)}
              </text>
            }
          >
            <LogoShimmerText
              text={titleLabel(props.title, SIDEBAR_CARD_TITLE_WIDTH)}
              ink={style.textColor(props.rowID, props.titleColor)}
              attributes={TextAttributes.BOLD}
              wrapMode="none"
              truncate
            />
          </Show>
        </box>
        <box
          height={1}
          paddingLeft={1}
          paddingRight={1}
          width="100%"
          flexDirection="row"
          alignItems="center"
          justifyContent="space-between"
        >
          <text fg={props.controller.theme.textMuted} overflow="hidden" wrapMode="none" truncate flexShrink={1}>
            {titleLabel(
              props.detail,
              props.progress ? SIDEBAR_CARD_PROGRESS_DETAIL_WIDTH : SIDEBAR_CARD_DETAIL_WIDTH,
            )}
          </text>
          <Show
            when={props.progress}
            fallback={props.statusText ? <text fg={props.borderColor}>{titleLabel(props.statusText, 17)}</text> : undefined}
          >
            <Show when={animationsEnabled()} fallback={<text fg={props.progressColor}>...</text>}>
              <spinner color={spinner().color} frames={spinner().frames} interval={40} />
            </Show>
          </Show>
        </box>
      </box>
    </box>
  )
}
