import { RGBA, TextAttributes } from "@opentui/core"
import { useKV } from "@tui/context/kv"
import { useRoute } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { useTheme } from "@tui/context/theme"
import { createColors, createFrames } from "@tui/ui/spinner"
import "opentui-spinner/solid"
import { createMemo, For, Show } from "solid-js"
import { LogoShimmerText } from "./logo"
import {
  dashboardRowColor,
  dashboardRowStatusLabel,
  dashboardStatusColor,
  dashboardStatusLabel,
  modelLabel,
  pathShortName,
  projectForSession,
  projectSummaryStatus,
  projectTitle,
  sessionSwarmTitle,
  timeAgo,
  truncate,
} from "./opencodex-operation-model"
import type {
  DashboardProjectSummary,
  DashboardRow,
  DashboardSession,
  DashboardStatus,
  OpencodeXProject,
  OpencodeXSwarm,
  OpencodeXView,
} from "./opencodex-operations-types"
import { REVIEW_READY_ICON, deriveStatus, isReviewReadyStatus } from "./opencodex-session-status"

function SessionFooterStatus(props: { status: DashboardStatus }) {
  const kv = useKV()
  const animationsEnabled = createMemo(() => kv.get("animations_enabled", true))
  const spinnerDef = createMemo(() => {
    const color = dashboardStatusColor("in_progress")
    return {
      frames: createFrames({ color, width: 4, style: "diamonds", inactiveFactor: 0.5, minAlpha: 0.3 }),
      color: createColors({ color, width: 4, style: "diamonds", inactiveFactor: 0.5, minAlpha: 0.3 }),
    }
  })
  return (
    <Show
      when={props.status === "in_progress"}
      fallback={
        <text fg={dashboardStatusColor(props.status)}>
          {isReviewReadyStatus(props.status) ? REVIEW_READY_ICON : dashboardStatusLabel(props.status)}
        </text>
      }
    >
      <Show when={animationsEnabled()} fallback={<text fg={dashboardStatusColor("in_progress")}>⋯</text>}>
        <spinner color={spinnerDef().color} frames={spinnerDef().frames} interval={40} />
      </Show>
    </Show>
  )
}

export function SessionCard(props: {
  session: DashboardSession
  projects: OpencodeXProject[]
  swarms: OpencodeXSwarm[]
  width: number
  displayStatus?: DashboardStatus
  selected?: boolean
}) {
  const { theme } = useTheme()
  const route = useRoute()
  const sync = useSync()
  const status = createMemo(() => props.displayStatus ?? deriveStatus(props.session.id, sync))
  const project = createMemo(() => projectForSession(props.projects, props.session.id))
  const detail = createMemo(() => [project() ? projectTitle(props.projects, project()!.id) : undefined, sessionSwarmTitle(props.session, props.swarms) ?? modelLabel(props.session)].filter(Boolean).join(" - "))
  const animatedTitle = createMemo(() => status() === "input_needed" || isReviewReadyStatus(status()))
  const titleColor = createMemo(() => isReviewReadyStatus(status()) ? dashboardStatusColor(status()) : theme.text)
  const titleInk = createMemo(() => animatedTitle() ? dashboardStatusColor(status()) : titleColor())
  return (
    <box width={props.width} flexShrink={0} flexDirection="column" paddingLeft={1} paddingRight={1} paddingTop={1} paddingBottom={1} backgroundColor={props.selected ? (theme.backgroundMenu ?? theme.backgroundElement) : theme.backgroundPanel} border={["left"]} borderColor={props.selected && !isReviewReadyStatus(status()) ? theme.primary : dashboardStatusColor(status())} onMouseUp={() => route.navigate({ type: "session", sessionID: props.session.id })}>
      <box flexDirection="row" gap={1} alignItems="center">
        <Show when={animatedTitle()} fallback={<text attributes={TextAttributes.BOLD} fg={titleColor()}>{truncate(props.session.title, props.width - 4)}</text>}>
          <LogoShimmerText text={truncate(props.session.title, props.width - 7)} ink={titleInk()} attributes={TextAttributes.BOLD} />
        </Show>
      </box>
      <Show when={detail()}><text fg={theme.textMuted}>{truncate(detail(), props.width - 4)}</text></Show>
      <box width="100%" flexDirection="row" justifyContent="space-between">
        <text fg={theme.textMuted}>{timeAgo(props.session.time.updated)}</text>
        <SessionFooterStatus status={status()} />
      </box>
    </box>
  )
}

export function ProjectCard(props: { summary: DashboardProjectSummary; width: number; selected?: boolean; active?: boolean; onSelect: () => void }) {
  const { theme } = useTheme()
  const status = createMemo(() => projectSummaryStatus(props.summary))
  const folder = createMemo(() => pathShortName(props.summary.project.folders?.[0]?.path ?? props.summary.project.project.worktree))
  const title = createMemo(() => props.summary.project.name ?? props.summary.project.project.name ?? props.summary.project.project.worktree)
  const attentionCount = createMemo(() => props.summary.rows.filter((row) => row.reason).length)
  const runningCount = createMemo(() => props.summary.rows.filter((row) => ["in_progress", "running", "queued", "retrying", "cancelling"].includes(row.status)).length)
  const swarmText = createMemo(() => props.summary.swarmCount === 0 ? "no swarms" : `${props.summary.swarmCount} swarm${props.summary.swarmCount === 1 ? "" : "s"}`)
  return (
    <box width={props.width} flexShrink={0} flexDirection="column" paddingLeft={1} paddingRight={1} paddingTop={1} paddingBottom={1} backgroundColor={props.active || props.selected ? (theme.backgroundMenu ?? theme.backgroundElement) : theme.backgroundPanel} border={["left"]} borderColor={props.selected || props.active ? theme.primary : dashboardStatusColor(status())} onMouseUp={props.onSelect}>
      <box width="100%" flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={props.active ? theme.primary : theme.text}>{truncate(title(), props.width - 13)}</text>
        <text fg={props.active ? theme.primary : theme.textMuted}>PROJECT</text>
      </box>
      <text fg={theme.textMuted}>{truncate(`${props.summary.sessionCount} session${props.summary.sessionCount === 1 ? "" : "s"} - ${swarmText()}`, props.width - 4)}</text>
      <box width="100%" flexDirection="row" justifyContent="space-between">
        <text fg={theme.textMuted}>{truncate(folder(), Math.max(8, props.width - 18))}</text>
        <text fg={attentionCount() > 0 ? dashboardStatusColor("input_needed") : runningCount() > 0 ? dashboardStatusColor("in_progress") : theme.textMuted}>
          {attentionCount() > 0 ? `${attentionCount()} attention` : runningCount() > 0 ? `${runningCount()} active` : "ready"}
        </text>
      </box>
      <box width="100%" flexDirection="row" justifyContent="space-between">
        <text fg={theme.textMuted}>{props.summary.lastUpdated > 0 ? timeAgo(props.summary.lastUpdated) : "no activity"}</text>
        <text attributes={props.active || props.selected ? TextAttributes.BOLD : undefined} fg={props.active || props.selected ? theme.primary : theme.textMuted}>{props.active ? "focused" : props.selected ? "enter focus" : "focus"}</text>
      </box>
    </box>
  )
}

export function AttentionCard(props: { row: DashboardRow; width: number; selected?: boolean }) {
  const { theme } = useTheme()
  const animatedTitle = createMemo(() => props.row.dashboardStatus === "input_needed" || isReviewReadyStatus(props.row.dashboardStatus ?? ""))
  const titleColor = createMemo(() => isReviewReadyStatus(props.row.dashboardStatus ?? "") ? dashboardRowColor(props.row, theme) : theme.text)
  const titleInk = createMemo(() => animatedTitle() ? dashboardRowColor(props.row, theme) : titleColor())
  return (
    <box width={props.width} flexShrink={0} flexDirection="column" paddingLeft={1} paddingRight={1} paddingTop={1} paddingBottom={1} backgroundColor={props.selected ? (theme.backgroundMenu ?? theme.backgroundElement) : theme.backgroundPanel} border={["left"]} borderColor={props.selected && !isReviewReadyStatus(props.row.dashboardStatus ?? "") ? theme.primary : dashboardRowColor(props.row, theme)} onMouseUp={props.row.open}>
      <Show when={animatedTitle()} fallback={<text attributes={TextAttributes.BOLD} fg={titleColor()}>{truncate(props.row.title, props.width - 4)}</text>}>
        <LogoShimmerText text={truncate(props.row.title, props.width - 7)} ink={titleInk()} attributes={TextAttributes.BOLD} />
      </Show>
      <Show when={props.row.subtitle}>{(subtitle) => <text fg={theme.textMuted}>{truncate(subtitle(), props.width - 4)}</text>}</Show>
      <box width="100%" flexDirection="row" justifyContent="space-between">
        <text fg={theme.textMuted}>{timeAgo(props.row.timeUpdated)}</text>
        <text fg={dashboardRowColor(props.row, theme)}>{isReviewReadyStatus(props.row.dashboardStatus ?? "") ? REVIEW_READY_ICON : dashboardRowStatusLabel(props.row)}</text>
      </box>
    </box>
  )
}

export function ViewCard(props: { view: OpencodeXView; status: DashboardStatus; width: number; selected?: boolean }) {
  const { theme } = useTheme()
  const route = useRoute()
  const sessionCount = createMemo(() => props.view.sessionIDs.length)
  const animatedTitle = createMemo(() => props.status === "input_needed" || isReviewReadyStatus(props.status))
  const titleColor = createMemo(() => isReviewReadyStatus(props.status) ? dashboardStatusColor(props.status) : theme.text)
  const titleInk = createMemo(() => animatedTitle() ? dashboardStatusColor(props.status) : titleColor())
  return (
    <box width={props.width} flexShrink={0} flexDirection="column" paddingLeft={1} paddingRight={1} paddingTop={1} paddingBottom={1} backgroundColor={props.selected ? (theme.backgroundMenu ?? theme.backgroundElement) : theme.backgroundPanel} border={["left"]} borderColor={props.selected && !isReviewReadyStatus(props.status) ? theme.primary : dashboardStatusColor(props.status)} onMouseUp={() => route.navigate({ type: "opencodex-view", viewID: props.view.id })}>
      <Show when={animatedTitle()} fallback={<text attributes={TextAttributes.BOLD} fg={titleColor()}>{truncate(props.view.title, props.width - 4)}</text>}>
        <LogoShimmerText text={truncate(props.view.title, props.width - 7)} ink={titleInk()} attributes={TextAttributes.BOLD} />
      </Show>
      <text fg={theme.textMuted}>{`${sessionCount()} session${sessionCount() === 1 ? "" : "s"}`}</text>
      <box width="100%" flexDirection="row" justifyContent="space-between">
        <text fg={theme.textMuted}>{timeAgo(props.view.timeUpdated)}</text>
        <SessionFooterStatus status={props.status} />
      </box>
    </box>
  )
}

export function EmptyCreateCard(props: { title: string; description: string; width: number; actionLabel?: string; selected?: boolean; onCreate: () => void }) {
  const { theme } = useTheme()
  return (
    <box width="100%" maxWidth={Math.max(48, props.width * 2)} flexShrink={0} flexDirection="row" gap={1} paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} backgroundColor={props.selected ? (theme.backgroundMenu ?? theme.backgroundElement) : undefined} border={["top", "bottom"]} borderColor={props.selected ? theme.primary : theme.border} onMouseUp={props.onCreate}>
      <text attributes={TextAttributes.BOLD} fg={props.selected ? theme.primary : theme.success}>+</text>
      <box flexGrow={1} minWidth={0} flexDirection="column">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>{props.title}</text>
        <text fg={theme.textMuted}>{truncate(props.description, Math.max(24, props.width * 2 - 12))}</text>
      </box>
      <text fg={props.selected ? theme.primary : theme.textMuted}>{props.selected ? `enter ${props.actionLabel ?? "create"}` : (props.actionLabel ?? "create")}</text>
    </box>
  )
}

export function DashboardCreateBar(props: { actions: { id: string; title: string; description: string; tone: RGBA; selected?: boolean; onSelect: () => void }[] }) {
  const { theme } = useTheme()
  return (
    <box flexShrink={0} flexDirection="row" flexWrap="wrap" gap={1}>
      <For each={props.actions}>
        {(action) => (
          <box width={24} flexShrink={0} flexDirection="column" paddingLeft={1} paddingRight={1} paddingTop={1} paddingBottom={1} backgroundColor={action.selected ? (theme.backgroundMenu ?? theme.backgroundElement) : theme.backgroundPanel} border={["left"]} borderColor={action.selected ? theme.primary : action.tone} onMouseUp={action.onSelect}>
            <box width="100%" flexDirection="row" justifyContent="space-between">
              <text attributes={TextAttributes.BOLD} fg={action.selected ? theme.primary : theme.text}>{action.title}</text>
              <text attributes={TextAttributes.BOLD} fg={action.selected ? theme.primary : action.tone}>+</text>
            </box>
            <text fg={theme.textMuted}>{truncate(action.description, 20)}</text>
          </box>
        )}
      </For>
    </box>
  )
}
