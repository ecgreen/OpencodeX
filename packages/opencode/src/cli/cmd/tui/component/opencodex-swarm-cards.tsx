import { TextAttributes } from "@opentui/core"
import { clientSwarmDisplayStatus, clientSwarmRunUpdated } from "@opencode-ai/sdk/v2/swarm-presentation"
import { useRoute } from "@tui/context/route"
import { useTheme } from "@tui/context/theme"
import { createMemo, Show } from "solid-js"
import {
  defaultTitle,
  projectTitle,
  statusColor,
  statusDot,
  swarmDisplayTimeUpdated,
  swarmRunLabel,
  timeAgo,
  truncate,
} from "./opencodex-operation-model"
import type { OpencodeXProject, OpencodeXSwarm, OpencodeXSwarmRole, OpencodeXSwarmRun } from "./opencodex-operations-types"

export function SwarmCard(props: {
  swarm: OpencodeXSwarm
  projects: OpencodeXProject[]
  width: number
  displayStatus?: string
  selected?: boolean
  showStatusDot?: boolean
}) {
  const { theme } = useTheme()
  const route = useRoute()
  const status = createMemo(() => props.displayStatus ?? clientSwarmDisplayStatus(props.swarm))
  return (
    <box
      width={props.width}
      flexShrink={0}
      flexDirection="column"
      paddingLeft={1}
      paddingRight={1}
      paddingTop={1}
      paddingBottom={1}
      backgroundColor={props.selected ? (theme.backgroundMenu ?? theme.backgroundElement) : theme.backgroundPanel}
      border={["left"]}
      borderColor={props.selected ? theme.primary : statusColor(status(), theme)}
      onMouseUp={() => route.navigate({ type: "opencodex-swarms", swarmID: props.swarm.id })}
    >
      <box flexDirection="row" gap={1} alignItems="center">
        <Show when={props.showStatusDot !== false}><text fg={statusColor(status(), theme)}>{statusDot(status())}</text></Show>
        <text attributes={TextAttributes.BOLD} fg={theme.text}>{truncate(props.swarm.title, props.showStatusDot === false ? props.width - 4 : props.width - 7)}</text>
      </box>
      <text fg={theme.textMuted}>{truncate(`${projectTitle(props.projects, props.swarm.projectID)} - ${swarmRunLabel(props.swarm)}`, props.width - 4)}</text>
      <box width="100%" flexDirection="row" justifyContent="space-between">
        <text fg={theme.textMuted}>{timeAgo(swarmDisplayTimeUpdated(props.swarm))}</text>
        <text fg={statusColor(status(), theme)}>{status()}</text>
      </box>
    </box>
  )
}

export function SwarmEmptyState(props: { width: number; onCreate: () => void }) {
  const { theme } = useTheme()
  return (
    <box width="100%" maxWidth={props.width} flexDirection="column" gap={1} paddingTop={2}>
      <box flexDirection="column" gap={0}>
        <text attributes={TextAttributes.BOLD} fg={theme.text}>No swarms yet</text>
        <text fg={theme.textMuted}>Create a reusable swarm and assign tasks from one place.</text>
      </box>
      <box width={Math.min(props.width, 46)} flexDirection="column" paddingLeft={1} paddingRight={1} paddingTop={1} paddingBottom={1} backgroundColor={theme.backgroundPanel} border={["left"]} borderColor={theme.warning} onMouseUp={props.onCreate}>
        <text attributes={TextAttributes.BOLD} fg={theme.warning}>Create a swarm</text>
        <text fg={theme.textMuted}>Pick an orchestrator and specialist roles.</text>
      </box>
    </box>
  )
}

export function SwarmAgentCard(props: { role: OpencodeXSwarmRole; width: number; lead?: boolean }) {
  const { theme } = useTheme()
  const model = createMemo(() => [props.role.providerID, props.role.modelID].filter(Boolean).join("/") || props.role.modelProfile || props.role.skill || props.role.agent || "No model assigned")
  return (
    <box width={props.width} flexShrink={0} flexDirection="column" paddingLeft={1} paddingRight={1} paddingBottom={1} backgroundColor={theme.backgroundPanel} border={["left"]} borderColor={statusColor(props.role.status, theme)}>
      <text attributes={TextAttributes.BOLD} fg={theme.text}>{truncate(props.role.name, props.width - 4)}</text>
      <text fg={theme.textMuted}>{props.lead ? "Orchestrator" : (props.role.skill ?? props.role.agent ?? "Specialist")}</text>
      <text fg={theme.textMuted}>{truncate(model(), props.width - 4)}</text>
      <box width="100%" flexDirection="row" justifyContent="space-between">
        <text fg={statusColor(props.role.status, theme)}>{props.role.status}</text>
        <text fg={theme.textMuted}>{props.role.timeUpdated ? timeAgo(props.role.timeUpdated) : ""}</text>
      </box>
    </box>
  )
}

export function SwarmTaskCard(props: { run: OpencodeXSwarmRun; status: string; width: number; selected: boolean; onSelect: () => void }) {
  const { theme } = useTheme()
  return (
    <box width={props.width} flexShrink={0} flexDirection="column" paddingLeft={1} paddingRight={1} paddingBottom={1} backgroundColor={props.selected ? (theme.backgroundMenu ?? theme.backgroundElement) : theme.backgroundPanel} border={["left"]} borderColor={props.selected ? theme.primary : statusColor(props.status, theme)} onMouseUp={props.onSelect}>
      <text attributes={TextAttributes.BOLD} fg={theme.text}>{truncate(props.run.title || defaultTitle(props.run.prompt ?? ""), props.width - 4)}</text>
      <text fg={theme.textMuted}>{truncate(props.run.prompt, props.width - 4)}</text>
      <box width="100%" flexDirection="row" justifyContent="space-between">
        <text fg={statusColor(props.status, theme)}>{props.status}</text>
        <text fg={theme.textMuted}>{timeAgo(clientSwarmRunUpdated(props.run))}</text>
      </box>
    </box>
  )
}

export function SwarmNewTaskCard(props: { width: number; selected: boolean; onSelect: () => void }) {
  const { theme } = useTheme()
  return (
    <box width={props.width} flexShrink={0} flexDirection="column" paddingLeft={1} paddingRight={1} paddingBottom={1} backgroundColor={props.selected ? (theme.backgroundMenu ?? theme.backgroundElement) : theme.backgroundPanel} border={["left"]} borderColor={props.selected ? theme.primary : theme.success} onMouseUp={props.onSelect}>
      <text attributes={TextAttributes.BOLD} fg={theme.success}>New Task</text>
      <text fg={theme.textMuted}>Start a new chat with this swarm</text>
    </box>
  )
}
