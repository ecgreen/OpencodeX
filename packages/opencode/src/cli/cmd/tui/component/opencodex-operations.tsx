import { RGBA, TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { Prompt, type PromptRef } from "@tui/component/prompt"
import { useSDK } from "@tui/context/sdk"
import { useSync } from "@tui/context/sync"
import { useRoute } from "@tui/context/route"
import { useTheme } from "@tui/context/theme"
import { usePromptRef } from "@tui/context/prompt"
import { useLocal } from "@tui/context/local"
import { useKV } from "@tui/context/kv"
import { useDialog } from "@tui/ui/dialog"
import { DialogAlert } from "@tui/ui/dialog-alert"
import { DialogConfirm } from "@tui/ui/dialog-confirm"
import { DialogPrompt } from "@tui/ui/dialog-prompt"
import { DialogSelect } from "@tui/ui/dialog-select"
import { DialogModel } from "@tui/component/dialog-model"
import { Toast } from "@tui/ui/toast"
import { createColors, createFrames } from "@tui/ui/spinner"
import "opentui-spinner/solid"
import { createEffect, createMemo, createResource, createSignal, For, Match, onCleanup, onMount, Show, Switch, type JSX } from "solid-js"
import { useBindings, useCommandShortcut } from "../keymap"
import { useTuiConfig } from "../context/tui-config"
import { getScrollAcceleration } from "../util/scroll"
import { Logo, LogoShimmerText } from "./logo"
import { useOxSidebar } from "./opencodex-sidebar"
import { setPendingOpencodeXProjectSession, setPendingOpencodeXSwarmTask } from "./opencodex-session-state"
import { createOpencodeXViewDialog } from "./opencodex-view-dialog"
import {
  NEW_RESULT_COLOR,
  type DerivedStatus,
  deriveStatus,
  statusColor as derivedStatusColor,
  statusLabel,
} from "./opencodex-session-status"

type OpencodeXProject = {
  id: string
  name?: string
  project: {
    id: string
    name?: string
    worktree: string
  }
  folders?: { path: string }[]
  sessions: ReturnType<typeof useSync>["data"]["session"]
}

type DashboardSession = ReturnType<typeof useSync>["data"]["session"][number]
type DashboardStatus = DerivedStatus | "review_ready" | "unviewed"
type DashboardSessionEntry = {
  session: DashboardSession
  status: DashboardStatus
}

type DashboardProjectSummary = {
  project: OpencodeXProject
  sessions: DashboardSessionEntry[]
  swarmCount: number
  activeSwarmCount: number
  lastUpdated: number
}

type AttentionEntry = DashboardSessionEntry & {
  reason: string
}

type OpencodeXSwarmRole = {
  id: string
  name: string
  status: string
  agent?: string
  skill?: string
  providerID?: string
  modelID?: string
  modelProfile?: string
  sessionID?: string
  currentSessionID?: string
  sessionIDs?: string[]
  runID?: string
  jobID?: string
  timeCreated?: number
  timeUpdated?: number
}

type OpencodeXSwarmAgentRun = {
  id: string
  runID: string
  swarmID: string
  roleID?: string
  status: string
  prompt: string
  sessionID?: string
  jobID?: string
  startedAt?: number
  completedAt?: number
  timeCreated?: number
  timeUpdated?: number
}

type OpencodeXSwarmRun = {
  id: string
  teamID?: string
  swarmID?: string
  title?: string
  prompt?: string
  status?: string
  orchestratorSessionID?: string
  resultSessionID?: string
  synthesisSessionID?: string
  roleSessionIDs?: string[]
  agents?: OpencodeXSwarmAgentRun[]
  startedAt?: number
  completedAt?: number
  timeCreated?: number
  timeStarted?: number
  timeCompleted?: number
  timeUpdated?: number
}

type OpencodeXSwarm = {
  id: string
  projectID: string
  title: string
  prompt: string
  status: string
  source: string
  synthesisSessionID?: string
  currentRunID?: string
  latestRunID?: string
  activeRunID?: string
  runID?: string
  runCount?: number
  currentRun?: OpencodeXSwarmRun
  latestRun?: OpencodeXSwarmRun
  runs?: OpencodeXSwarmRun[]
  roles: OpencodeXSwarmRole[]
  events: {
    id: string
    kind: string
    message: string
    roleID?: string
    timeCreated: number
  }[]
  timeCreated: number
  timeUpdated: number
}

type OpencodeXView = {
  id: string
  title: string
  sessionIDs: string[]
  focusedSessionID?: string
  timeUpdated: number
}

const swarmRunPlaceholder = {
  normal: [
    "Assign a task to implement the next feature",
    "Assign a task to investigate a regression",
    "Assign a task to review the current plan",
  ],
  shell: ["git status", "pwd", "rg TODO"],
}

const swarmRouteBindingCommands = [
  "opencodex.swarm.route.up",
  "opencodex.swarm.route.down",
  "opencodex.swarm.route.open",
  "opencodex.swarm.route.create",
  "opencodex.swarm.route.dashboard",
  "opencodex.swarm.route.refresh",
] as const

type DashboardItem =
  | {
      id: string
      kind: "section"
      action: () => void
    }
  | {
      id: string
      kind: "item"
      action: () => void
    }

type SwarmRolePreset = {
  name: string
  skill: string
  description: string
  selected?: boolean
}

type SwarmRoleDraft = SwarmRolePreset & {
  selected?: boolean
  customInstructions: string
  providerID?: string
  modelID?: string
  existing?: boolean
}

type ModelSelection = {
  providerID: string
  modelID: string
}

const ORCHESTRATOR_PRESET: SwarmRolePreset = {
  name: "Orchestrator",
  skill: "orchestrator",
  description: "Coordinates the swarm, manages dependencies, and plans synthesis.",
}

const SWARM_ROLE_PRESETS: SwarmRolePreset[] = [
  {
    name: "Product Manager",
    skill: "product-manager",
    description: "Frames goals, workflows, acceptance criteria, and tradeoffs.",
  },
  {
    name: "Architect",
    skill: "architect",
    description: "Designs integration boundaries, data flow, and rollout risks.",
  },
  {
    name: "Senior Engineer",
    skill: "senior-engineer",
    description: "Plans or implements the concrete engineering work.",
  },
  {
    name: "QA Engineer",
    skill: "qa-engineer",
    description: "Defines validation, edge cases, and regression coverage.",
  },
  {
    name: "Code Reviewer",
    skill: "code-reviewer",
    description: "Reviews for bugs, regressions, maintainability, and missing tests.",
  },
  {
    name: "Docs Engineer",
    skill: "docs-engineer",
    description: "Produces guides, API docs, migration notes, and release docs.",
  },
  {
    name: "Release Engineer",
    skill: "release-engineer",
    description: "Plans packaging, changelog, rollout, and rollback steps.",
  },
  {
    name: "Security Reviewer",
    skill: "security-reviewer",
    description: "Reviews trust boundaries, permissions, secrets, and automation safety.",
  },
]

const REVIEW_READY_PURPLE = RGBA.fromInts(192, 132, 252, 255)

function timeAgo(input: number) {
  const seconds = Math.max(0, Math.floor((Date.now() - input) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function projectTitle(projects: OpencodeXProject[], projectID?: string) {
  const project = projects.find((item) => item.id === projectID)
  return project?.name ?? project?.project.name ?? project?.project.worktree ?? "Unassigned"
}

function projectForSession(projects: OpencodeXProject[], sessionID: string) {
  return projects.find((project) => project.sessions.some((session) => session.id === sessionID))
}

function statusDot(status: string) {
  if (["running", "queued", "in_progress"].includes(status)) return "*"
  if (["input_needed", "approval_needed", "blocked"].includes(status)) return "!"
  if (status === "failed") return "x"
  if (status === "completed") return "+"
  if (status === "cancelled") return "-"
  return "o"
}

function statusColor(status: string, theme: ReturnType<typeof useTheme>["theme"]) {
  if (status === "running" || status === "in_progress") return theme.info
  if (status === "queued") return theme.textMuted
  if (["input_needed", "approval_needed", "blocked"].includes(status)) return theme.warning
  if (status === "failed") return theme.error
  if (status === "completed") return theme.success
  return theme.textMuted
}

function isActiveSwarm(status: string) {
  return ["queued", "running", "in_progress", "input_needed", "approval_needed", "blocked"].includes(status)
}

function runUpdated(run: OpencodeXSwarmRun) {
  return run.timeUpdated ?? run.completedAt ?? run.timeCompleted ?? run.startedAt ?? run.timeStarted ?? run.timeCreated ?? 0
}

function currentSwarmRun(swarm: OpencodeXSwarm) {
  const preferredID = swarm.currentRunID ?? swarm.activeRunID ?? swarm.latestRunID ?? swarm.runID
  const preferred = preferredID ? swarm.runs?.find((run) => run.id === preferredID) : undefined
  return preferred ?? swarm.currentRun ?? swarm.latestRun ?? swarm.runs?.toSorted((a, b) => runUpdated(b) - runUpdated(a))[0]
}

function activeSwarmRun(swarm: OpencodeXSwarm) {
  return swarmRuns(swarm).find((run) => ["queued", "running", "approval_needed", "blocked"].includes(run.status ?? ""))
}

function swarmRuns(swarm: OpencodeXSwarm) {
  return (swarm.runs ?? []).toSorted((a, b) => runUpdated(b) - runUpdated(a))
}

function swarmRunCount(swarm: OpencodeXSwarm) {
  return swarm.runCount ?? swarm.runs?.length ?? (swarm.prompt ? 1 : 0)
}

function swarmRunLabel(swarm: OpencodeXSwarm) {
  const count = swarmRunCount(swarm)
  if (count === 0) return "no tasks"
  if (count === 1) return "1 task"
  return `${count} tasks`
}

function swarmDisplayStatus(swarm: OpencodeXSwarm) {
  const active = activeSwarmRun(swarm)
  if (active) return active.status ?? "running"
  const run = currentSwarmRun(swarm)
  if (run) return run.status ?? swarm.status
  if (swarm.status === "running") return "planned"
  return swarm.status
}

function swarmDisplayPrompt(swarm: OpencodeXSwarm) {
  return currentSwarmRun(swarm)?.prompt ?? swarm.prompt
}

function swarmRunSessionID(run: OpencodeXSwarmRun) {
  return run.resultSessionID ?? run.synthesisSessionID ?? run.orchestratorSessionID
}

function swarmRunStatus(run: OpencodeXSwarmRun, sync: ReturnType<typeof useSync>) {
  const sessionID = swarmRunSessionID(run)
  if (!sessionID) return run.status ?? "queued"
  return deriveStatus(sessionID, sync)
}

function swarmDisplayTimeUpdated(swarm: OpencodeXSwarm) {
  return runUpdated(currentSwarmRun(swarm) ?? { id: swarm.id, timeUpdated: swarm.timeUpdated }) || swarm.timeUpdated
}

function isOrchestratorSwarmRole(role: OpencodeXSwarmRole) {
  return role.skill === "orchestrator" || role.name.trim().toLowerCase() === "orchestrator"
}

function swarmLeadRole(roles: OpencodeXSwarmRole[]) {
  return roles.find(isOrchestratorSwarmRole) ?? roles[0]
}

function swarmSpecialistRoles(roles: OpencodeXSwarmRole[]) {
  const lead = swarmLeadRole(roles)
  if (!lead) return roles
  return roles.filter((role) => role.id !== lead.id)
}

function sessionMetadata(session: DashboardSession): Record<string, unknown> | undefined {
  return "metadata" in session ? (session.metadata as Record<string, unknown> | undefined) : undefined
}

function sessionSwarmID(session: DashboardSession) {
  const opencodex = sessionMetadata(session)?.opencodex
  if (typeof opencodex !== "object" || opencodex === null || !("swarmID" in opencodex)) return undefined
  return typeof opencodex.swarmID === "string" ? opencodex.swarmID : undefined
}

function sessionSwarmTitle(session: DashboardSession, swarms: OpencodeXSwarm[]) {
  const swarmID = sessionSwarmID(session)
  if (!swarmID) return undefined
  return swarms.find((swarm) => swarm.id === swarmID)?.title
}

function dashboardStatusColor(status: DashboardStatus) {
  if (status === "unviewed") return NEW_RESULT_COLOR
  if (status === "review_ready") return REVIEW_READY_PURPLE
  return derivedStatusColor(status)
}

function dashboardStatusLabel(status: DashboardStatus) {
  if (status === "unviewed") return "new result"
  if (status === "review_ready") return "ready for review"
  return statusLabel(status)
}

function isUnviewed(session: DashboardSession, local: ReturnType<typeof useLocal>) {
  return session.time.updated > local.session.lastViewed(session.id)
}

function dashboardSessionEntry(session: DashboardSession, sync: ReturnType<typeof useSync>, local: ReturnType<typeof useLocal>): DashboardSessionEntry {
  const status = deriveStatus(session.id, sync)
  return {
    session,
    status: status === "dormant" && isUnviewed(session, local) ? "unviewed" : status,
  }
}

function attentionReason(entry: DashboardSessionEntry, sync: ReturnType<typeof useSync>) {
  const permissions = sync.data.permission[entry.session.id] ?? []
  if (permissions.length > 0) return `${permissions.length} permission request${permissions.length === 1 ? "" : "s"}`
  const questions = sync.data.question[entry.session.id] ?? []
  if (questions.length > 0) return `${questions.length} question${questions.length === 1 ? "" : "s"} waiting`
  if (entry.status === "unviewed") return "new result since last viewed"
  if (entry.status === "review_ready") return "ready for review"
  return undefined
}

function projectSummaryStatus(summary: DashboardProjectSummary): DashboardStatus {
  if (summary.sessions.some((entry) => entry.status === "input_needed")) return "input_needed"
  if (summary.sessions.some((entry) => entry.status === "in_progress") || summary.activeSwarmCount > 0) return "in_progress"
  if (summary.sessions.some((entry) => entry.status === "unviewed")) return "unviewed"
  return "dormant"
}

function projectSummaryLabel(summary: DashboardProjectSummary) {
  const input = summary.sessions.filter((entry) => entry.status === "input_needed").length
  if (input > 0) return `${input} need input`
  const running = summary.sessions.filter((entry) => entry.status === "in_progress").length + summary.activeSwarmCount
  if (running > 0) return `${running} running`
  const unviewed = summary.sessions.filter((entry) => entry.status === "unviewed").length
  if (unviewed > 0) return `${unviewed} new`
  return "quiet"
}

function truncate(input: string | undefined, length: number) {
  if (!input) return ""
  return input.length > length ? input.slice(0, length - 3) + "..." : input
}

function defaultTitle(input: string) {
  return truncate(input.trim() || "Untitled task", 48)
}

function modelLabel(session: DashboardSession) {
  const model = session.model?.id ?? ""
  return model.slice(model.lastIndexOf("/") + 1)
}

function modelDisplay(
  providers: ReturnType<typeof useSync>["data"]["provider"],
  model: { providerID?: string; modelID?: string },
) {
  if (!model.providerID || !model.modelID) return "Select model"
  const provider = providers.find((item) => item.id === model.providerID)
  const info = provider?.models[model.modelID]
  return [provider?.name ?? model.providerID, info?.name ?? model.modelID].join(" / ")
}

function createRoleDraft(preset: SwarmRolePreset, model?: { providerID: string; modelID: string }): SwarmRoleDraft {
  return {
    ...preset,
    customInstructions: "",
    providerID: model?.providerID,
    modelID: model?.modelID,
  }
}

function roleDraftFromSwarmRole(role: OpencodeXSwarmRole): SwarmRoleDraft {
  return {
    name: role.name,
    skill: role.skill ?? role.agent ?? role.name.trim().toLowerCase().replace(/\s+/g, "-"),
    description: role.instructions,
    customInstructions: role.instructions,
    providerID: role.providerID,
    modelID: role.modelID,
    existing: true,
  }
}

function roleInstructions(role: SwarmRoleDraft) {
  const base = `Use the built-in "${role.skill}" swarm role skill markdown as the default guidance.`
  if (role.existing) return role.customInstructions.trim() || base
  const custom = role.customInstructions.trim()
  if (!custom) return base
  return `${base}\n\nAdditional custom instructions:\n${custom}`
}

function GradientTitle(props: { text: string; active: boolean }) {
  if (!props.active) return <text attributes={TextAttributes.BOLD} fg={dashboardStatusColor("review_ready")}>{props.text}</text>
  const midpoint = Math.ceil(props.text.length / 2)
  return (
    <text attributes={TextAttributes.BOLD}>
      <span style={{ fg: RGBA.fromInts(147, 197, 253, 255) }}>{props.text.slice(0, midpoint)}</span>
      <span style={{ fg: RGBA.fromInts(103, 232, 249, 255) }}>{props.text.slice(midpoint)}</span>
    </text>
  )
}

export async function createOpencodeXSwarmDialog(input: {
  sdk: ReturnType<typeof useSDK>
  dialog: ReturnType<typeof useDialog>
  route: ReturnType<typeof useRoute>
  theme: ReturnType<typeof useTheme>["theme"]
}) {
  input.dialog.clear()
  input.route.navigate({ type: "opencodex-swarm-create" })
}

export async function selectOpencodeXSwarmDialog(input: {
  sdk: ReturnType<typeof useSDK>
  dialog: ReturnType<typeof useDialog>
  route: ReturnType<typeof useRoute>
}) {
  const swarms = await input.sdk.request<OpencodeXSwarm[]>("/experimental/opencodex/swarm").catch((error: Error) => {
    void DialogAlert.show(input.dialog, "Open Swarm", error.message)
  })
  if (!swarms) return
  const projects = await input.sdk.request<OpencodeXProject[]>("/experimental/opencodex/project").catch(() => [])
  const list = swarms.toSorted((a, b) => swarmDisplayTimeUpdated(b) - swarmDisplayTimeUpdated(a))

  if (list.length === 0) {
    await DialogAlert.show(input.dialog, "Open Swarm", "Create a swarm before opening one.")
    return
  }

  input.dialog.replace(() => (
    <DialogSelect
      title="Open swarm"
      placeholder="Search swarms"
      options={list.map((swarm) => ({
        title: swarm.title,
        value: swarm.id,
        description: projectTitle(projects, swarm.projectID),
        footer: `${swarmDisplayStatus(swarm)} - ${swarmRunLabel(swarm)} - ${swarm.roles.length} roles - ${timeAgo(swarmDisplayTimeUpdated(swarm))}`,
        onSelect: () => {
          input.dialog.clear()
          input.route.navigate({ type: "opencodex-swarms", swarmID: swarm.id })
        },
      }))}
    />
  ))
}

export async function selectOpencodeXSwarmTaskDialog(input: {
  sdk: ReturnType<typeof useSDK>
  dialog: ReturnType<typeof useDialog>
  route: ReturnType<typeof useRoute>
}) {
  const swarms = await input.sdk.request<OpencodeXSwarm[]>("/experimental/opencodex/swarm").catch((error: Error) => {
    void DialogAlert.show(input.dialog, "New Swarm Task", error.message)
  })
  if (!swarms) return
  const projects = await input.sdk.request<OpencodeXProject[]>("/experimental/opencodex/project").catch(() => [])
  const list = swarms.toSorted((a, b) => swarmDisplayTimeUpdated(b) - swarmDisplayTimeUpdated(a))

  if (list.length === 0) {
    await DialogAlert.show(input.dialog, "New Swarm Task", "Create a swarm before assigning a task.")
    return
  }

  input.dialog.replace(() => (
    <DialogSelect
      title="New swarm task"
      placeholder="Search swarms"
      options={list.map((swarm) => ({
        title: swarm.title,
        value: swarm.id,
        description: projectTitle(projects, swarm.projectID),
        footer: `${swarmDisplayStatus(swarm)} - ${swarmRunLabel(swarm)} - ${swarm.roles.length} roles - ${timeAgo(swarmDisplayTimeUpdated(swarm))}`,
        onSelect: () => {
          input.dialog.clear()
          setPendingOpencodeXProjectSession(undefined)
          setPendingOpencodeXSwarmTask({ swarmID: swarm.id, title: swarm.title })
          input.route.navigate({ type: "home" })
        },
      }))}
    />
  ))
}

function Section(props: {
  title: string
  count?: number
  required?: boolean
  collapsible?: boolean
  collapsed?: boolean
  selected?: boolean
  onSelect?: () => void
  onToggle?: () => void
  action?: { label: string; selected?: boolean; onSelect: () => void }
  children: JSX.Element
}) {
  const { theme } = useTheme()
  const [internalCollapsed, setInternalCollapsed] = createSignal(false)
  const collapsed = createMemo(() => props.collapsed ?? internalCollapsed())
  const toggle = () => {
    if (!props.collapsible) return
    props.onSelect?.()
    if (props.onToggle) {
      props.onToggle()
      return
    }
    setInternalCollapsed((value) => !value)
  }
  return (
    <box flexDirection="column" gap={1} paddingTop={1}>
      <box
        flexDirection="row"
        gap={1}
        backgroundColor={props.selected ? theme.backgroundPanel : undefined}
        onMouseUp={toggle}
      >
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          {props.collapsible ? `${collapsed() ? "[+] " : "[-] "}` : ""}{props.title}
          <Show when={props.required}>
            <span style={{ fg: theme.error }}> *</span>
          </Show>
        </text>
        <Show when={props.count !== undefined && props.count > 0}>
          <text fg={theme.textMuted}>({props.count})</text>
        </Show>
        <Show when={props.action}>
          {(action) => (
            <text
              attributes={action().selected ? TextAttributes.BOLD : undefined}
              bg={action().selected ? theme.backgroundMenu ?? theme.backgroundElement : undefined}
              fg={action().selected ? theme.primary : theme.primary}
              onMouseUp={(event: { stopPropagation(): void }) => {
                event.stopPropagation()
                action().onSelect()
              }}
            >
              {action().label}
            </text>
          )}
        </Show>
      </box>
      <Show when={!props.collapsible || !collapsed()}>
        <box flexDirection="column" gap={0}>
          {props.children}
        </box>
      </Show>
    </box>
  )
}

function CardGrid(props: { children: JSX.Element }) {
  return (
    <box flexDirection="row" flexWrap="wrap" gap={1}>
      {props.children}
    </box>
  )
}

function TopLogoNav(props: { label?: string; onSelect: () => void }) {
  const { theme } = useTheme()
  return (
    <box flexShrink={0} flexDirection="column" gap={0}>
      <box flexDirection="row" justifyContent="space-between">
        <box flexGrow={1} />
        <box flexShrink={0} alignItems="center" flexDirection="column">
          <Logo idle />
          <Show when={props.label}>
            <box width="100%" flexDirection="row" justifyContent="flex-end" paddingRight={3}>
              <text attributes={TextAttributes.BOLD} fg={theme.warning} onMouseUp={() => props.onSelect()}>
                {props.label}
              </text>
            </box>
          </Show>
        </box>
        <box flexGrow={1} />
      </box>
    </box>
  )
}

function EmptyRow(props: { text: string }) {
  const { theme } = useTheme()
  return <text fg={theme.textMuted}>{props.text}</text>
}

function SwarmCard(props: { swarm: OpencodeXSwarm; projects: OpencodeXProject[]; width: number; displayStatus?: string; selected?: boolean }) {
  const { theme } = useTheme()
  const route = useRoute()
  const status = createMemo(() => props.displayStatus ?? swarmDisplayStatus(props.swarm))
  const updated = createMemo(() => swarmDisplayTimeUpdated(props.swarm))
  return (
    <box
      width={props.width}
      flexShrink={0}
      flexDirection="column"
      paddingLeft={1}
      paddingRight={1}
      paddingTop={1}
      paddingBottom={1}
      backgroundColor={props.selected ? theme.backgroundMenu ?? theme.backgroundElement : theme.backgroundPanel}
      border={["left"]}
      borderColor={props.selected ? theme.primary : statusColor(status(), theme)}
      onMouseUp={() => route.navigate({ type: "opencodex-swarms", swarmID: props.swarm.id })}
    >
      <box flexDirection="row" gap={1} alignItems="center">
        <text fg={statusColor(status(), theme)}>{statusDot(status())}</text>
        <text attributes={TextAttributes.BOLD} fg={theme.text}>{truncate(props.swarm.title, props.width - 7)}</text>
      </box>
      <text fg={theme.textMuted}>{truncate(`${projectTitle(props.projects, props.swarm.projectID)} - ${swarmRunLabel(props.swarm)}`, props.width - 4)}</text>
      <box width="100%" flexDirection="row" justifyContent="space-between">
        <text fg={theme.textMuted}>{timeAgo(updated())}</text>
        <text fg={statusColor(status(), theme)}>{status()}</text>
      </box>
    </box>
  )
}

function SwarmEmptyState(props: { width: number; onCreate: () => void }) {
  const { theme } = useTheme()
  return (
    <box width="100%" maxWidth={props.width} flexDirection="column" gap={1} paddingTop={2}>
      <box flexDirection="column" gap={0}>
        <text attributes={TextAttributes.BOLD} fg={theme.text}>No swarms yet</text>
        <text fg={theme.textMuted}>Create a reusable swarm and assign tasks from one place.</text>
      </box>
      <box
        width={Math.min(props.width, 46)}
        flexDirection="column"
        paddingLeft={1}
        paddingRight={1}
        paddingTop={1}
        paddingBottom={1}
        backgroundColor={theme.backgroundPanel}
        border={["left"]}
        borderColor={theme.warning}
        onMouseUp={() => props.onCreate()}
      >
        <text attributes={TextAttributes.BOLD} fg={theme.warning}>Create a swarm</text>
        <text fg={theme.textMuted}>Pick an orchestrator and specialist roles.</text>
      </box>
    </box>
  )
}

function SwarmAgentCard(props: { role: OpencodeXSwarmRole; width: number; lead?: boolean }) {
  const { theme } = useTheme()
  const model = createMemo(() =>
    [props.role.providerID, props.role.modelID].filter(Boolean).join("/") ||
    props.role.modelProfile ||
    props.role.skill ||
    props.role.agent ||
    "No model assigned",
  )
  return (
    <box
      width={props.width}
      flexShrink={0}
      flexDirection="column"
      paddingLeft={1}
      paddingRight={1}
      paddingBottom={1}
      backgroundColor={theme.backgroundPanel}
      border={["left"]}
      borderColor={statusColor(props.role.status, theme)}
    >
      <text attributes={TextAttributes.BOLD} fg={theme.text}>{truncate(props.role.name, props.width - 4)}</text>
      <text fg={theme.textMuted}>{props.lead ? "Orchestrator" : props.role.skill ?? props.role.agent ?? "Specialist"}</text>
      <text fg={theme.textMuted}>{truncate(model(), props.width - 4)}</text>
      <box width="100%" flexDirection="row" justifyContent="space-between">
        <text fg={statusColor(props.role.status, theme)}>{props.role.status}</text>
        <text fg={theme.textMuted}>{props.role.timeUpdated ? timeAgo(props.role.timeUpdated) : ""}</text>
      </box>
    </box>
  )
}

function SwarmTaskCard(props: {
  run: OpencodeXSwarmRun
  status: string
  width: number
  selected: boolean
  onSelect: () => void
}) {
  const { theme } = useTheme()
  return (
    <box
      width={props.width}
      flexShrink={0}
      flexDirection="column"
      paddingLeft={1}
      paddingRight={1}
      paddingBottom={1}
      backgroundColor={props.selected ? theme.backgroundMenu ?? theme.backgroundElement : theme.backgroundPanel}
      border={["left"]}
      borderColor={props.selected ? theme.primary : statusColor(props.status, theme)}
      onMouseUp={props.onSelect}
    >
      <text attributes={TextAttributes.BOLD} fg={theme.text}>{truncate(props.run.title || defaultTitle(props.run.prompt ?? ""), props.width - 4)}</text>
      <text fg={theme.textMuted}>{truncate(props.run.prompt, props.width - 4)}</text>
      <box width="100%" flexDirection="row" justifyContent="space-between">
        <text fg={statusColor(props.status, theme)}>{props.status}</text>
        <text fg={theme.textMuted}>{timeAgo(runUpdated(props.run))}</text>
      </box>
    </box>
  )
}

function SwarmNewTaskCard(props: {
  width: number
  selected: boolean
  onSelect: () => void
}) {
  const { theme } = useTheme()
  return (
    <box
      width={props.width}
      flexShrink={0}
      flexDirection="column"
      paddingLeft={1}
      paddingRight={1}
      paddingBottom={1}
      backgroundColor={props.selected ? theme.backgroundMenu ?? theme.backgroundElement : theme.backgroundPanel}
      border={["left"]}
      borderColor={props.selected ? theme.primary : theme.success}
      onMouseUp={props.onSelect}
    >
      <text attributes={TextAttributes.BOLD} fg={theme.success}>New Task</text>
      <text fg={theme.textMuted}>Start a new chat with this swarm</text>
    </box>
  )
}

function SessionFooterStatus(props: { status: DashboardStatus }) {
  const kv = useKV()
  const animationsEnabled = createMemo(() => kv.get("animations_enabled", true))
  const spinnerDef = createMemo(() => {
    const color = dashboardStatusColor("in_progress")
    return {
      frames: createFrames({
        color,
        width: 4,
        style: "diamonds",
        inactiveFactor: 0.5,
        minAlpha: 0.3,
      }),
      color: createColors({
        color,
        width: 4,
        style: "diamonds",
        inactiveFactor: 0.5,
        minAlpha: 0.3,
      }),
    }
  })

  return (
    <Show
      when={props.status === "in_progress"}
      fallback={<text fg={dashboardStatusColor(props.status)}>{dashboardStatusLabel(props.status)}</text>}
    >
      <Show when={animationsEnabled()} fallback={<text fg={dashboardStatusColor("in_progress")}>⋯</text>}>
        <spinner color={spinnerDef().color} frames={spinnerDef().frames} interval={40} />
      </Show>
    </Show>
  )
}

function SessionCard(props: {
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
  const detail = createMemo(() =>
    [project() ? projectTitle(props.projects, project()!.id) : undefined, sessionSwarmTitle(props.session, props.swarms) ?? modelLabel(props.session)]
      .filter(Boolean)
      .join(" - "),
  )
  const defaultTitleColor = createMemo(() => status() === "in_progress" ? dashboardStatusColor(status()) : theme.text)
  return (
    <box
      width={props.width}
      flexShrink={0}
      flexDirection="column"
      paddingLeft={1}
      paddingRight={1}
      paddingTop={1}
      paddingBottom={1}
      backgroundColor={props.selected ? theme.backgroundMenu ?? theme.backgroundElement : theme.backgroundPanel}
      border={["left"]}
      borderColor={props.selected ? theme.primary : dashboardStatusColor(status())}
      onMouseUp={() => route.navigate({ type: "session", sessionID: props.session.id })}
    >
      <box flexDirection="row" gap={1} alignItems="center">
        <Show
          when={status() === "review_ready" || status() === "unviewed"}
          fallback={<text attributes={TextAttributes.BOLD} fg={defaultTitleColor()}>{truncate(props.session.title, props.width - 4)}</text>}
        >
          <Show
            when={status() === "unviewed"}
            fallback={<GradientTitle text={truncate(props.session.title, props.width - 7)} active />}
          >
            <LogoShimmerText
              text={truncate(props.session.title, props.width - 7)}
              ink={NEW_RESULT_COLOR}
              attributes={TextAttributes.BOLD}
            />
          </Show>
        </Show>
      </box>
      <Show when={detail()}>
        <text fg={theme.textMuted}>{truncate(detail(), props.width - 4)}</text>
      </Show>
      <box width="100%" flexDirection="row" justifyContent="space-between">
        <text fg={theme.textMuted}>{timeAgo(props.session.time.updated)}</text>
        <SessionFooterStatus status={status()} />
      </box>
    </box>
  )
}

function ProjectCard(props: {
  summary: DashboardProjectSummary
  width: number
  selected?: boolean
  active?: boolean
  onSelect: () => void
}) {
  const { theme } = useTheme()
  const status = createMemo(() => projectSummaryStatus(props.summary))
  const folder = createMemo(() => props.summary.project.folders?.[0]?.path ?? props.summary.project.project.worktree)
  const title = createMemo(() => props.summary.project.name ?? props.summary.project.project.name ?? props.summary.project.project.worktree)
  const sessionCount = createMemo(() => props.summary.sessions.length)
  const swarmText = createMemo(() =>
    props.summary.swarmCount === 0
      ? "no swarms"
      : `${props.summary.swarmCount} swarm${props.summary.swarmCount === 1 ? "" : "s"}`,
  )
  return (
    <box
      width={props.width}
      flexShrink={0}
      flexDirection="column"
      paddingLeft={1}
      paddingRight={1}
      paddingTop={1}
      paddingBottom={1}
      backgroundColor={props.selected || props.active ? theme.backgroundMenu ?? theme.backgroundElement : theme.backgroundPanel}
      border={["left"]}
      borderColor={props.selected ? theme.primary : dashboardStatusColor(status())}
      onMouseUp={props.onSelect}
    >
      <text attributes={TextAttributes.BOLD} fg={props.active ? theme.primary : theme.text}>
        {truncate(title(), props.width - 4)}
      </text>
      <text fg={theme.textMuted}>
        {truncate(`${sessionCount()} session${sessionCount() === 1 ? "" : "s"} - ${swarmText()}`, props.width - 4)}
      </text>
      <text fg={theme.textMuted}>{truncate(folder(), props.width - 4)}</text>
      <box width="100%" flexDirection="row" justifyContent="space-between">
        <text fg={theme.textMuted}>{props.summary.lastUpdated > 0 ? timeAgo(props.summary.lastUpdated) : "no activity"}</text>
        <text fg={dashboardStatusColor(status())}>{projectSummaryLabel(props.summary)}</text>
      </box>
    </box>
  )
}

function AttentionCard(props: {
  entry: AttentionEntry
  projects: OpencodeXProject[]
  swarms: OpencodeXSwarm[]
  width: number
  selected?: boolean
}) {
  const { theme } = useTheme()
  const route = useRoute()
  const project = createMemo(() => projectForSession(props.projects, props.entry.session.id))
  const detail = createMemo(() =>
    [project() ? projectTitle(props.projects, project()!.id) : undefined, sessionSwarmTitle(props.entry.session, props.swarms) ?? modelLabel(props.entry.session)]
      .filter(Boolean)
      .join(" - "),
  )
  return (
    <box
      width={props.width}
      flexShrink={0}
      flexDirection="column"
      paddingLeft={1}
      paddingRight={1}
      paddingTop={1}
      paddingBottom={1}
      backgroundColor={props.selected ? theme.backgroundMenu ?? theme.backgroundElement : theme.backgroundPanel}
      border={["left"]}
      borderColor={props.selected ? theme.primary : dashboardStatusColor(props.entry.status)}
      onMouseUp={() => route.navigate({ type: "session", sessionID: props.entry.session.id })}
    >
      <text attributes={TextAttributes.BOLD} fg={dashboardStatusColor(props.entry.status)}>
        {truncate(props.entry.reason, props.width - 4)}
      </text>
      <text fg={theme.text}>{truncate(props.entry.session.title, props.width - 4)}</text>
      <Show when={detail()}>
        <text fg={theme.textMuted}>{truncate(detail(), props.width - 4)}</text>
      </Show>
      <box width="100%" flexDirection="row" justifyContent="space-between">
        <text fg={theme.textMuted}>{timeAgo(props.entry.session.time.updated)}</text>
        <text fg={dashboardStatusColor(props.entry.status)}>{dashboardStatusLabel(props.entry.status)}</text>
      </box>
    </box>
  )
}

function ViewCard(props: { view?: OpencodeXView; width: number; create?: boolean; selected?: boolean; onCreate?: () => void }) {
  const { theme } = useTheme()
  const route = useRoute()
  const title = createMemo(() => props.view?.title ?? "Create view")
  const sessionCount = createMemo(() => props.view?.sessionIDs.length ?? 0)
  return (
    <box
      width={props.width}
      flexShrink={0}
      flexDirection="column"
      paddingLeft={1}
      paddingRight={1}
      paddingTop={1}
      paddingBottom={1}
      backgroundColor={props.selected ? theme.backgroundMenu ?? theme.backgroundElement : theme.backgroundPanel}
      border={["left"]}
      borderColor={props.selected ? theme.primary : props.create ? theme.success : theme.primary}
      onMouseUp={() => {
        if (props.create) {
          props.onCreate?.()
          return
        }
        if (props.view) route.navigate({ type: "opencodex-view", viewID: props.view.id })
      }}
    >
      <text attributes={TextAttributes.BOLD} fg={props.create ? theme.success : theme.text}>
        {truncate(title(), props.width - 4)}
      </text>
      <text fg={theme.textMuted}>
        {props.create ? "1-8 sessions" : `${sessionCount()} session${sessionCount() === 1 ? "" : "s"}`}
      </text>
      <box width="100%" flexDirection="row" justifyContent="space-between">
        <text fg={theme.textMuted}>{props.create ? "Create a multi-session view" : props.view ? timeAgo(props.view.timeUpdated) : ""}</text>
        <box flexDirection="row" gap={1}>
          <text fg={props.create ? theme.success : theme.primary}>{props.create ? "new" : "open"}</text>
        </box>
      </box>
    </box>
  )
}

function EmptyCreateCard(props: {
  title: string
  description: string
  width: number
  selected?: boolean
  onCreate: () => void
}) {
  const { theme } = useTheme()
  return (
    <box
      width={props.width}
      flexShrink={0}
      flexDirection="column"
      paddingLeft={1}
      paddingRight={1}
      paddingTop={1}
      paddingBottom={1}
      backgroundColor={props.selected ? theme.backgroundMenu ?? theme.backgroundElement : theme.backgroundPanel}
      border={["left"]}
      borderColor={props.selected ? theme.primary : theme.success}
      onMouseUp={() => props.onCreate()}
    >
      <text attributes={TextAttributes.BOLD} fg={theme.success}>{props.title}</text>
      <text fg={theme.textMuted}>{truncate(props.description, props.width - 4)}</text>
      <box width="100%" flexDirection="row" justifyContent="flex-end">
        <text fg={theme.success}>new</text>
      </box>
    </box>
  )
}

export function OpencodeXDashboard() {
  const sdk = useSDK()
  const sync = useSync()
  const local = useLocal()
  const { theme } = useTheme()
  const route = useRoute()
  const dialog = useDialog()
  const promptRef = usePromptRef()
  const dimensions = useTerminalDimensions()
  const tuiConfig = useTuiConfig()
  const [, setOxSidebarOpen] = useOxSidebar()
  const [refresh, setRefresh] = createSignal(0)
  const [selected, setSelected] = createSignal(0)
  const [selectedProjectID, setSelectedProjectID] = createSignal<string>()
  const [projectsCollapsed, setProjectsCollapsed] = createSignal(false)
  const [attentionCollapsed, setAttentionCollapsed] = createSignal(false)
  const [sessionsCollapsed, setSessionsCollapsed] = createSignal(false)
  const [swarmsCollapsed, setSwarmsCollapsed] = createSignal(false)
  const [viewsCollapsed, setViewsCollapsed] = createSignal(false)
  const [projects] = createResource(refresh, () => sdk.request<OpencodeXProject[]>("/experimental/opencodex/project"))
  const [swarms] = createResource(refresh, () => sdk.request<OpencodeXSwarm[]>("/experimental/opencodex/swarm"))
  const [views] = createResource(refresh, () => sdk.request<OpencodeXView[]>("/experimental/opencodex/view"))
  const scrollAcceleration = createMemo(() => getScrollAcceleration(tuiConfig))
  const cardWidth = createMemo(() => {
    if (dimensions().width >= 150) return 42
    if (dimensions().width >= 110) return 38
    return 34
  })
  const paletteShortcut = useCommandShortcut("command.palette.show")
  const shortcutHint = createMemo(() =>
    [
      "arrows/j/k select",
      "enter open",
      paletteShortcut() && `${paletteShortcut()} commands`,
    ].filter(Boolean).join("  "),
  )

  onMount(() => {
    setOxSidebarOpen(true)
    promptRef.current?.blur()
    promptRef.set(undefined)
    const timer = setInterval(() => setRefresh((value) => value + 1), 2500)
    onCleanup(() => clearInterval(timer))
  })

  const topLevelSessions = createMemo(() => {
    const byID = new Map<string, DashboardSession>()
    for (const project of projects() ?? []) {
      for (const session of project.sessions) {
        if (!session.parentID) byID.set(session.id, session)
      }
    }
    for (const session of sync.data.session) {
      if (!session.parentID) byID.set(session.id, session)
    }
    return [...byID.values()]
  })
  const selectedProject = createMemo(() => (projects() ?? []).find((project) => project.id === selectedProjectID()))
  const selectedProjectSessionIDs = createMemo(() => new Set(selectedProject()?.sessions.map((session) => session.id) ?? []))
  const allDashboardSessions = createMemo(() =>
    topLevelSessions()
      .map((session) => dashboardSessionEntry(session, sync, local))
      .toSorted((a, b) => b.session.time.updated - a.session.time.updated)
  )
  const sessionInScope = (session: DashboardSession) => !selectedProjectID() || selectedProjectSessionIDs().has(session.id)
  const dashboardSessions = createMemo(() => allDashboardSessions().filter((entry) => sessionInScope(entry.session)))
  const sortedSwarms = createMemo(() =>
    (swarms() ?? [])
      .filter((swarm) => !selectedProjectID() || swarm.projectID === selectedProjectID())
      .toSorted((a, b) => swarmDisplayTimeUpdated(b) - swarmDisplayTimeUpdated(a)),
  )
  const sortedViews = createMemo(() => (views() ?? []).toSorted((a, b) => b.timeUpdated - a.timeUpdated))
  const displaySwarmStatus = (swarm: OpencodeXSwarm) => {
    const active = swarmRuns(swarm).find((run) => {
      const sessionID = swarmRunSessionID(run)
      if (!sessionID) return false
      return deriveStatus(sessionID, sync) !== "dormant"
    })
    if (active) return swarmRunStatus(active, sync)
    const run = currentSwarmRun(swarm)
    const sessionID = run ? swarmRunSessionID(run) : undefined
    if (sessionID && deriveStatus(sessionID, sync) === "dormant") return "dormant"
    const status = swarmDisplayStatus(swarm)
    return status === "running" ? "dormant" : status
  }
  const projectSummaries = createMemo(() =>
    (projects() ?? [])
      .map((project) => {
        const sessionIDs = new Set(project.sessions.map((session) => session.id))
        const sessions = allDashboardSessions().filter((entry) => sessionIDs.has(entry.session.id))
        const projectSwarms = (swarms() ?? []).filter((swarm) => swarm.projectID === project.id)
        return {
          project,
          sessions,
          swarmCount: projectSwarms.length,
          activeSwarmCount: projectSwarms.filter((swarm) => isActiveSwarm(displaySwarmStatus(swarm))).length,
          lastUpdated: Math.max(
            0,
            ...sessions.map((entry) => entry.session.time.updated),
            ...projectSwarms.map(swarmDisplayTimeUpdated),
          ),
        }
      })
      .toSorted((a, b) => b.lastUpdated - a.lastUpdated),
  )
  const attentionEntries = createMemo(() =>
    dashboardSessions()
      .map((entry) => ({ ...entry, reason: attentionReason(entry, sync) }))
      .filter((entry): entry is AttentionEntry => entry.reason !== undefined)
      .toSorted((a, b) => b.session.time.updated - a.session.time.updated),
  )
  const createSession = () => {
    const project = selectedProject()
    setPendingOpencodeXProjectSession(
      project ? { projectID: project.id, directory: project.folders?.[0]?.path ?? project.project.worktree } : undefined,
    )
    route.navigate({ type: "home" })
    dialog.clear()
  }
  const createSwarm = () => route.navigate({ type: "opencodex-swarm-create" })
  const clearProject = () => setSelectedProjectID(undefined)
  const selectProject = (projectID: string) => setSelectedProjectID((current) => current === projectID ? undefined : projectID)
  const createView = () =>
    createOpencodeXViewDialog({
      sdk,
      dialog,
      route,
      sessionIDs: dashboardSessions().slice(0, 4).map((entry) => entry.session.id),
      onCreated: () => setRefresh((value) => value + 1),
    })
  const dashboardItems = createMemo<DashboardItem[]>(() => [
    { id: "section:projects", kind: "section", action: () => setProjectsCollapsed((value) => !value) },
    ...(selectedProjectID()
      ? [{ id: "action:clear-project", kind: "item" as const, action: clearProject }]
      : []),
    ...(projectsCollapsed()
      ? []
      : projectSummaries().length > 0
        ? projectSummaries().map((summary) => ({
            id: `project:${summary.project.id}`,
            kind: "item" as const,
            action: () => selectProject(summary.project.id),
          }))
        : [{ id: "empty:projects", kind: "item" as const, action: () => setOxSidebarOpen(true) }]),
    { id: "section:attention", kind: "section", action: () => setAttentionCollapsed((value) => !value) },
    ...(attentionCollapsed()
      ? []
      : attentionEntries().map((entry) => ({
          id: `attention:${entry.session.id}`,
          kind: "item" as const,
          action: () => route.navigate({ type: "session", sessionID: entry.session.id }),
        }))),
    { id: "section:sessions", kind: "section", action: () => setSessionsCollapsed((value) => !value) },
    ...(dashboardSessions().length > 0
      ? [{ id: "action:new-session", kind: "item" as const, action: createSession }]
      : []),
    ...(sessionsCollapsed()
      ? []
      : dashboardSessions().length > 0
        ? dashboardSessions().map((entry) => ({
            id: `session:${entry.session.id}`,
            kind: "item" as const,
            action: () => route.navigate({ type: "session", sessionID: entry.session.id }),
          }))
        : [{ id: "empty:sessions", kind: "item" as const, action: createSession }]),
    { id: "section:swarms", kind: "section", action: () => setSwarmsCollapsed((value) => !value) },
    ...(sortedSwarms().length > 0
      ? [{ id: "action:new-swarm", kind: "item" as const, action: createSwarm }]
      : []),
    ...(swarmsCollapsed()
      ? []
      : sortedSwarms().length > 0
        ? sortedSwarms().map((swarm) => ({
            id: `swarm:${swarm.id}`,
            kind: "item" as const,
            action: () => route.navigate({ type: "opencodex-swarms", swarmID: swarm.id }),
          }))
        : [{ id: "empty:swarms", kind: "item" as const, action: createSwarm }]),
    { id: "section:views", kind: "section", action: () => setViewsCollapsed((value) => !value) },
    ...(sortedViews().length > 0
      ? [{ id: "action:new-view", kind: "item" as const, action: () => void createView() }]
      : []),
    ...(viewsCollapsed()
      ? []
      : sortedViews().length > 0
        ? sortedViews().map((view) => ({
            id: `view:${view.id}`,
            kind: "item" as const,
            action: () => route.navigate({ type: "opencodex-view", viewID: view.id }),
          }))
        : [{ id: "empty:views", kind: "item" as const, action: () => void createView() }]),
  ])
  const selectedItem = createMemo(() => dashboardItems()[selected()] ?? dashboardItems()[0])
  const isSelected = (id: string) => selectedItem()?.id === id
  const selectByID = (id: string) => {
    const index = dashboardItems().findIndex((item) => item.id === id)
    if (index >= 0) setSelected(index)
  }
  const move = (offset: number) => {
    const items = dashboardItems()
    if (items.length === 0) return
    setSelected((selected() + offset + items.length) % items.length)
  }
  const openSelected = () => {
    selectedItem()?.action()
  }

  createEffect(() => {
    if (selected() < dashboardItems().length) return
    setSelected(Math.max(0, dashboardItems().length - 1))
  })

  createEffect(() => {
    if (!selectedProjectID() || selectedProject()) return
    setSelectedProjectID(undefined)
  })

  useBindings(() => ({
    enabled: route.data.type === "opencodex-dashboard" && dialog.stack.length === 0,
    commands: [
      { name: "opencodex.dashboard.route.up", title: "Select previous dashboard item", category: "OpencodeX", run: () => move(-1) },
      { name: "opencodex.dashboard.route.down", title: "Select next dashboard item", category: "OpencodeX", run: () => move(1) },
      { name: "opencodex.dashboard.route.open", title: "Open dashboard item", category: "OpencodeX", run: openSelected },
      { name: "opencodex.dashboard.route.refresh", title: "Refresh dashboard", category: "OpencodeX", run: () => setRefresh((value) => value + 1) },
    ],
    bindings: [
      { key: "up,k", desc: "Select previous", group: "OpencodeX", cmd: () => move(-1) },
      { key: "down,j", desc: "Select next", group: "OpencodeX", cmd: () => move(1) },
      { key: "return,space", desc: "Open selected item", group: "OpencodeX", cmd: openSelected },
    ],
  }))

  return (
    <box flexGrow={1} minHeight={0} flexDirection="column" paddingLeft={2} paddingRight={2} paddingTop={1} gap={1}>
      <box flexGrow={1} minHeight={0} flexDirection="column" gap={1}>
        <TopLogoNav onSelect={() => route.navigate({ type: "opencodex-dashboard" })} />
        <scrollbox
          flexGrow={1}
          minHeight={0}
          scrollAcceleration={scrollAcceleration()}
          verticalScrollbarOptions={{
            trackOptions: {
              backgroundColor: theme.backgroundElement,
              foregroundColor: theme.border,
            },
          }}
        >
          <Section
            title="Projects"
            count={projectSummaries().length}
            collapsible
            collapsed={projectsCollapsed()}
            selected={isSelected("section:projects")}
            onSelect={() => selectByID("section:projects")}
            onToggle={() => setProjectsCollapsed((value) => !value)}
            action={selectedProjectID() ? { label: "All projects", selected: isSelected("action:clear-project"), onSelect: clearProject } : undefined}
          >
            <CardGrid>
              <Show
                when={projectSummaries().length > 0}
                fallback={
                  <EmptyCreateCard
                    title="Use sidebar projects"
                    description="Open the sidebar project tools."
                    width={cardWidth()}
                    selected={isSelected("empty:projects")}
                    onCreate={() => setOxSidebarOpen(true)}
                  />
                }
              >
                <For each={projectSummaries()}>
                  {(summary) => (
                    <ProjectCard
                      summary={summary}
                      width={cardWidth()}
                      selected={isSelected(`project:${summary.project.id}`)}
                      active={selectedProjectID() === summary.project.id}
                      onSelect={() => selectProject(summary.project.id)}
                    />
                  )}
                </For>
              </Show>
            </CardGrid>
          </Section>

          <Section
            title="Attention Needed"
            count={attentionEntries().length}
            collapsible
            collapsed={attentionCollapsed()}
            selected={isSelected("section:attention")}
            onSelect={() => selectByID("section:attention")}
            onToggle={() => setAttentionCollapsed((value) => !value)}
          >
            <Show
              when={attentionEntries().length > 0}
              fallback={<EmptyRow text={selectedProject() ? "Nothing needs attention in this project." : "Nothing needs attention right now."} />}
            >
              <CardGrid>
                <For each={attentionEntries()}>
                  {(entry) => (
                    <AttentionCard
                      entry={entry}
                      projects={projects() ?? []}
                      swarms={swarms() ?? []}
                      width={cardWidth()}
                      selected={isSelected(`attention:${entry.session.id}`)}
                    />
                  )}
                </For>
              </CardGrid>
            </Show>
          </Section>

          <Section
            title="Sessions"
            count={dashboardSessions().length}
            collapsible
            collapsed={sessionsCollapsed()}
            selected={isSelected("section:sessions")}
            onSelect={() => selectByID("section:sessions")}
            onToggle={() => setSessionsCollapsed((value) => !value)}
            action={dashboardSessions().length > 0 ? { label: "+ New session", selected: isSelected("action:new-session"), onSelect: createSession } : undefined}
          >
              <CardGrid>
                <Show
                  when={dashboardSessions().length > 0}
                  fallback={
                    <EmptyCreateCard
                      title="Create session"
                      description="Start a new chat from the dashboard."
                      width={cardWidth()}
                      selected={isSelected("empty:sessions")}
                      onCreate={createSession}
                    />
                  }
                >
                  <For each={dashboardSessions()}>
                    {(entry) => (
                      <SessionCard
                        session={entry.session}
                        projects={projects() ?? []}
                        swarms={swarms() ?? []}
                        width={cardWidth()}
                        displayStatus={entry.status}
                        selected={isSelected(`session:${entry.session.id}`)}
                      />
                    )}
                  </For>
                </Show>
              </CardGrid>
          </Section>

          <Section
            title="Swarms"
            count={sortedSwarms().length}
            collapsible
            collapsed={swarmsCollapsed()}
            selected={isSelected("section:swarms")}
            onSelect={() => selectByID("section:swarms")}
            onToggle={() => setSwarmsCollapsed((value) => !value)}
            action={sortedSwarms().length > 0 ? { label: "+ New swarm", selected: isSelected("action:new-swarm"), onSelect: createSwarm } : undefined}
          >
            <CardGrid>
              <Show
                when={sortedSwarms().length > 0}
                fallback={
                  <EmptyCreateCard
                    title="Create swarm"
                    description="Build an Agent team"
                    width={cardWidth()}
                    selected={isSelected("empty:swarms")}
                    onCreate={createSwarm}
                  />
                }
              >
                <For each={sortedSwarms()}>
                  {(swarm) => (
                    <SwarmCard
                      swarm={swarm}
                      projects={projects() ?? []}
                      width={cardWidth()}
                      displayStatus={displaySwarmStatus(swarm)}
                      selected={isSelected(`swarm:${swarm.id}`)}
                    />
                  )}
                </For>
              </Show>
            </CardGrid>
          </Section>

          <Section
            title="Views"
            count={sortedViews().length}
            collapsible
            collapsed={viewsCollapsed()}
            selected={isSelected("section:views")}
            onSelect={() => selectByID("section:views")}
            onToggle={() => setViewsCollapsed((value) => !value)}
            action={sortedViews().length > 0 ? { label: "+ New view", selected: isSelected("action:new-view"), onSelect: () => void createView() } : undefined}
          >
            <CardGrid>
              <Show
                when={sortedViews().length > 0}
                fallback={
                  <ViewCard
                    width={cardWidth()}
                    create
                    selected={isSelected("empty:views")}
                    onCreate={() => void createView()}
                  />
                }
              >
                <For each={sortedViews()}>
                  {(view) => (
                    <ViewCard
                      view={view}
                      width={cardWidth()}
                      selected={isSelected(`view:${view.id}`)}
                    />
                  )}
                </For>
              </Show>
            </CardGrid>
          </Section>
        </scrollbox>
      </box>
      <text fg={theme.textMuted}>{shortcutHint()}</text>
      <Toast />
    </box>
  )
}

function SwarmCreateRow(props: {
  title: string
  value: string
  description?: string
  required?: boolean
  selected: boolean
  onSelect: () => void
}) {
  const { theme } = useTheme()
  return (
    <box
      flexDirection="column"
      paddingLeft={1}
      paddingRight={1}
      paddingTop={1}
      paddingBottom={1}
      backgroundColor={theme.backgroundPanel}
      border={["left"]}
      borderColor={props.selected ? theme.primary : theme.textMuted}
      onMouseUp={() => props.onSelect()}
    >
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={props.selected ? theme.primary : theme.text}>
          {props.title}
          <Show when={props.required}>
            <span style={{ fg: theme.error }}> *</span>
          </Show>
        </text>
        <text fg={theme.textMuted}>edit</text>
      </box>
      <text fg={theme.text}>{truncate(props.value, 110)}</text>
      <Show when={props.description}>
        <text fg={theme.textMuted}>{props.description}</text>
      </Show>
    </box>
  )
}

function SwarmRoleDraftCard(props: {
  role: SwarmRoleDraft
  selected: boolean
  selectedModel?: boolean
  selectedInstructions?: boolean
  selectedRemove?: boolean
  providers: ReturnType<typeof useSync>["data"]["provider"]
  modelRequired?: boolean
  onSelect?: () => void
  onModel: () => void
  onInstructions: () => void
  onRemove?: () => void
}) {
  const { theme } = useTheme()
  const tone = createMemo(() => {
    if (props.selected) return theme.primary
    return theme.success
  })
  return (
    <box
      flexDirection="column"
      gap={0}
      paddingLeft={1}
      paddingRight={1}
      paddingTop={1}
      paddingBottom={1}
      backgroundColor={theme.backgroundPanel}
      border={["left"]}
      borderColor={tone()}
      onMouseUp={() => props.onSelect?.()}
    >
      <box flexDirection="row" justifyContent="space-between">
        <box flexDirection="row" gap={1}>
          <text fg={tone()}>+</text>
          <text attributes={TextAttributes.BOLD} fg={theme.text}>{props.role.name}</text>
        </box>
        <box flexDirection="row" gap={1}>
          <text fg={theme.textMuted}>{props.role.skill}.md</text>
          <Show when={props.onRemove}>
            <text fg={props.selectedRemove ? theme.primary : theme.error} onMouseUp={(event: { stopPropagation(): void }) => { event.stopPropagation(); props.onRemove?.() }}>
              remove
            </text>
          </Show>
        </box>
      </box>
      <text fg={theme.textMuted}>{props.role.description}</text>
      <box flexDirection="row" gap={1}>
        <text fg={props.selectedModel ? theme.primary : theme.textMuted} onMouseUp={(event: { stopPropagation(): void }) => { event.stopPropagation(); props.onModel() }}>
          model
          <Show when={props.modelRequired}>
            <span style={{ fg: theme.error }}> *</span>
          </Show>
        </text>
        <text fg={theme.textMuted}>{truncate(modelDisplay(props.providers, props.role), 86)}</text>
      </box>
      <box flexDirection="row" gap={1}>
        <text fg={props.selectedInstructions ? theme.primary : theme.textMuted} onMouseUp={(event: { stopPropagation(): void }) => { event.stopPropagation(); props.onInstructions() }}>
          instructions
        </text>
        <text fg={theme.textMuted}>{props.role.customInstructions.trim() ? truncate(props.role.customInstructions, 80) : "Default role skill only"}</text>
      </box>
    </box>
  )
}

function SwarmAddAgentCard(props: {
  selected: boolean
  disabled: boolean
  onSelect: () => void
}) {
  const { theme } = useTheme()
  return (
    <box
      flexDirection="column"
      paddingLeft={1}
      paddingRight={1}
      paddingTop={1}
      paddingBottom={1}
      backgroundColor={theme.backgroundPanel}
      border={["left"]}
      borderColor={props.selected ? theme.primary : theme.textMuted}
      onMouseUp={() => {
        if (!props.disabled) props.onSelect()
      }}
    >
      <box flexDirection="row" gap={1}>
        <text fg={props.disabled ? theme.textMuted : theme.primary}>+</text>
        <text attributes={TextAttributes.BOLD} fg={props.disabled ? theme.textMuted : theme.text}>
          Add specialist
        </text>
      </box>
      <text fg={theme.textMuted}>
        {props.disabled ? "All predefined roles are already assigned." : "Choose a specialist role, model, and custom instructions."}
      </text>
    </box>
  )
}

function OpencodeXSwarmCreate() {
  const sdk = useSDK()
  const sync = useSync()
  const local = useLocal()
  const route = useRoute()
  const dialog = useDialog()
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()
  const tuiConfig = useTuiConfig()
  const [, setOxSidebarOpen] = useOxSidebar()
  const [projects] = createResource(() => sdk.request<OpencodeXProject[]>("/experimental/opencodex/project"))
  const editSwarmID = createMemo(() => route.data.type === "opencodex-swarm-create" ? route.data.swarmID : undefined)
  const [editSwarm] = createResource(editSwarmID, (swarmID) =>
    swarmID ? sdk.request<OpencodeXSwarm>(`/experimental/opencodex/swarm/${swarmID}`) : undefined,
  )
  const initialModel = local.model.current()
  const [projectID, setProjectID] = createSignal<string | undefined>()
  const [title, setTitle] = createSignal("")
  const [orchestrator, setOrchestrator] = createSignal(createRoleDraft(ORCHESTRATOR_PRESET, initialModel))
  const [roles, setRoles] = createSignal<SwarmRoleDraft[]>([])
  const [selected, setSelected] = createSignal(0)
  const [creating, setCreating] = createSignal(false)
  const [initializedSwarmID, setInitializedSwarmID] = createSignal<string>()
  const editing = createMemo(() => editSwarmID() !== undefined)

  const promptMaxWidth = createMemo(() => {
    const configured = tuiConfig.prompt?.max_width
    if (configured === "auto") return Math.max(75, Math.floor(dimensions().width * 0.7))
    return configured ?? 75
  })
  const scrollAcceleration = createMemo(() => getScrollAcceleration(tuiConfig))
  const selectedRoles = createMemo(() => roles())
  const availableRoles = createMemo(() => {
    const assigned = new Set(roles().map((role) => role.skill))
    return SWARM_ROLE_PRESETS.filter((role) => !assigned.has(role.skill))
  })
  const editorItems = createMemo(() => [
    ...(!editing() ? [{ id: "project", action: selectProject }] : []),
    { id: "title", action: editTitle },
    { id: "orchestrator-name", action: editOrchestratorName },
    { id: "orchestrator-model", action: () => selectModel("orchestrator") },
    { id: "orchestrator-instructions", action: () => editInstructions("orchestrator") },
    ...roles().flatMap((role) => [
      { id: `role:${role.skill}`, action: () => editInstructions(role.skill) },
      { id: `role-model:${role.skill}`, action: () => selectModel(role.skill) },
      { id: `role-instructions:${role.skill}`, action: () => editInstructions(role.skill) },
      { id: `role-remove:${role.skill}`, action: () => removeRole(role.skill) },
    ]),
    { id: "add-agent", action: () => void addAgent() },
    { id: "create", action: saveSwarm },
    { id: "cancel", action: cancelCreate },
  ])

  createEffect(() => {
    if (selected() >= editorItems().length) setSelected(Math.max(0, editorItems().length - 1))
  })

  onMount(() => {
    setOxSidebarOpen(true)
  })

  createEffect(() => {
    const swarm = editSwarm()
    if (!swarm || initializedSwarmID() === swarm.id) return
    const lead = swarmLeadRole(swarm.roles)
    setProjectID(swarm.projectID)
    setTitle(swarm.title)
    setOrchestrator(lead ? roleDraftFromSwarmRole(lead) : createRoleDraft(ORCHESTRATOR_PRESET, initialModel))
    setRoles(swarmSpecialistRoles(swarm.roles).map(roleDraftFromSwarmRole))
    setInitializedSwarmID(swarm.id)
  })

  function isSelected(id: string) {
    return editorItems()[selected()]?.id === id
  }

  function move(offset: number) {
    const count = editorItems().length
    if (count === 0) return
    setSelected((selected() + offset + count) % count)
  }

  function openSelected() {
    editorItems()[selected()]?.action()
  }

  function updateRole(skill: string, update: (role: SwarmRoleDraft) => SwarmRoleDraft) {
    if (skill === "orchestrator") {
      setOrchestrator((role) => update(role))
      return
    }
    setRoles((items) => items.map((role) => (role.skill === skill ? update(role) : role)))
  }

  function removeRole(skill: string) {
    setRoles((items) => items.filter((role) => role.skill !== skill))
  }

  function cancelCreate() {
    route.back(editSwarmID() ? { type: "opencodex-swarms", swarmID: editSwarmID() } : { type: "opencodex-dashboard" })
  }

  function selectProject() {
    const list = projects() ?? []
    if (list.length === 0) return
    dialog.replace(() => (
      <DialogSelect
        title="Swarm project"
        options={list.map((project) => ({
          title: projectTitle(list, project.id),
          value: project.id,
          footer: project.project.worktree,
          onSelect: () => {
            setProjectID(project.id)
            dialog.clear()
          },
        }))}
        current={projectID()}
      />
    ))
  }

  function selectAgentRole() {
    const list = availableRoles()
    if (list.length === 0) {
      void DialogAlert.show(dialog, "Add Specialist", "All predefined roles are already assigned.")
      return Promise.resolve(undefined)
    }
    return new Promise<SwarmRolePreset | undefined>((resolve) => {
      let settled = false
      const settle = (value?: SwarmRolePreset) => {
        if (settled) return
        settled = true
        resolve(value)
      }
      dialog.replace(
        () => (
          <DialogSelect
            title="Specialist role"
            options={list.map((role) => ({
              title: role.name,
              value: role,
              description: role.description,
              footer: `${role.skill}.md`,
              onSelect: (ctx) => {
                settle(role)
                ctx.clear()
              },
            }))}
          />
        ),
        () => settle(),
      )
    })
  }

  function selectAgentModel(role: SwarmRoleDraft) {
    return new Promise<ModelSelection | undefined>((resolve) => {
      let settled = false
      const settle = (value?: ModelSelection) => {
        if (settled) return
        settled = true
        resolve(value)
      }
      dialog.replace(
        () => (
          <DialogModel
            current={role.providerID && role.modelID ? { providerID: role.providerID, modelID: role.modelID } : undefined}
            onSelect={settle}
          />
        ),
        () => settle(),
      )
    })
  }

  async function addAgent() {
    const preset = await selectAgentRole()
    if (!preset) return
    const model = await selectAgentModel(createRoleDraft(preset, initialModel))
    if (!model) return
    const instructions = await DialogPrompt.show(dialog, `${preset.name} instructions`, {
      placeholder: "Optional custom instructions",
      description: () => <text fg={theme.textMuted}>Default guidance comes from {preset.skill}.md; this field appends extra instructions.</text>,
    })
    if (instructions === null) return
    const nextRoles = [
      ...roles(),
      {
        ...createRoleDraft(preset, model),
        customInstructions: instructions,
      },
    ]
    setRoles(nextRoles)
    setSelected(5 + nextRoles.length * 4)
  }

  async function editTitle() {
    const value = await DialogPrompt.show(dialog, "Swarm title", {
      placeholder: "Optional title",
      value: title(),
      description: () => <text fg={theme.textMuted}>Leave blank to use the first task as the title later.</text>,
    })
    if (value !== null) setTitle(value)
  }

  async function editOrchestratorName() {
    const value = await DialogPrompt.show(dialog, "Orchestrator name", {
      placeholder: "Orchestrator",
      value: orchestrator().name,
      description: () => <text fg={theme.textMuted}>The orchestrator is always the first swarm role.</text>,
    })
    if (value === null) return
    const name = value.trim()
    if (!name) {
      await DialogAlert.show(dialog, "Create Swarm", "Orchestrator name cannot be empty.")
      return
    }
    setOrchestrator((role) => ({ ...role, name }))
  }

  function selectModel(skill: string) {
    const role = skill === "orchestrator" ? orchestrator() : roles().find((item) => item.skill === skill)
    if (!role) return
    dialog.replace(() => (
      <DialogModel
        current={role.providerID && role.modelID ? { providerID: role.providerID, modelID: role.modelID } : undefined}
        onSelect={(model) => updateRole(skill, (item) => ({ ...item, providerID: model.providerID, modelID: model.modelID }))}
      />
    ))
  }

  async function editInstructions(skill: string) {
    const role = skill === "orchestrator" ? orchestrator() : roles().find((item) => item.skill === skill)
    if (!role) return
    const value = await DialogPrompt.show(dialog, `${role.name} instructions`, {
      placeholder: "Optional custom instructions",
      value: role.customInstructions,
      description: () => <text fg={theme.textMuted}>Default guidance comes from {role.skill}.md; this field appends extra instructions.</text>,
    })
    if (value !== null) updateRole(skill, (item) => ({ ...item, customInstructions: value }))
  }

  async function saveSwarm() {
    if (creating()) return
    if (editing() && !editSwarm()) {
      await DialogAlert.show(dialog, "Edit Swarm", "Swarm config is still loading.")
      return
    }
    const project = projectID()
    if (!project && !editing()) {
      await DialogAlert.show(dialog, "Create Swarm", "Select an OpencodeX project first.")
      return
    }
    const lead = orchestrator()
    if (!lead.providerID || !lead.modelID) {
      await DialogAlert.show(dialog, editing() ? "Edit Swarm" : "Create Swarm", "Select the orchestrator model first.")
      return
    }
    if (selectedRoles().length === 0) {
      await DialogAlert.show(dialog, editing() ? "Edit Swarm" : "Create Swarm", "Add at least one specialist role.")
      return
    }
    if (selectedRoles().some((role) => !role.providerID || !role.modelID)) {
      await DialogAlert.show(dialog, editing() ? "Edit Swarm" : "Create Swarm", "Select a model for every specialist role.")
      return
    }
    setCreating(true)
    const payload = {
      title: title().trim() || undefined,
      roles: [lead, ...selectedRoles()].map((role) => ({
        name: role.name,
        skill: role.skill,
        providerID: role.providerID,
        modelID: role.modelID,
        instructions: roleInstructions(role),
      })),
    }
    const swarm = await (editing() && editSwarmID()
      ? sdk.request<OpencodeXSwarm>(`/experimental/opencodex/swarm/${editSwarmID()}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        })
      : sdk.request<OpencodeXSwarm>("/experimental/opencodex/swarm", {
          method: "POST",
          body: JSON.stringify({
            projectID: project,
            ...payload,
          }),
        }))
      .catch((error: Error) => {
        void DialogAlert.show(dialog, editing() ? "Edit Swarm" : "Create Swarm", error.message)
      })
    setCreating(false)
    if (swarm) route.navigate({ type: "opencodex-swarms", swarmID: swarm.id })
  }

  useBindings(() => ({
    enabled: route.data.type === "opencodex-swarm-create" && dialog.stack.length === 0,
    commands: [
      { name: "opencodex.swarm.route.up", title: "Select previous field", category: "OpencodeX", run: () => move(-1) },
      { name: "opencodex.swarm.route.down", title: "Select next field", category: "OpencodeX", run: () => move(1) },
      { name: "opencodex.swarm.route.open", title: "Edit selected field", category: "OpencodeX", run: openSelected },
      { name: "opencodex.swarm.route.create", title: editing() ? "Save swarm" : "Create swarm", category: "OpencodeX", run: () => void saveSwarm() },
      { name: "opencodex.swarm.route.back", title: editing() ? "Cancel edit swarm" : "Cancel create swarm", category: "OpencodeX", run: cancelCreate },
      { name: "opencodex.swarm.route.dashboard", title: "Open dashboard", category: "OpencodeX", run: () => route.navigate({ type: "opencodex-dashboard" }) },
    ],
    bindings: [
      ...tuiConfig.keybinds.gather("opencodex.swarm.route", swarmRouteBindingCommands),
      { key: "up,k", desc: "Select previous field", group: "OpencodeX", cmd: () => move(-1) },
      { key: "down,j", desc: "Select next field", group: "OpencodeX", cmd: () => move(1) },
      {
        key: "tab",
        desc: "Select next field",
        group: "OpencodeX",
        cmd: ({ event }: { event: { shift: boolean } }) => move(event.shift ? -1 : 1),
      },
      { key: "return,space", desc: "Edit selected field", group: "OpencodeX", cmd: openSelected },
      { key: "escape", desc: "Cancel create swarm", group: "OpencodeX", cmd: cancelCreate },
    ],
  }))

  return (
    <box flexGrow={1} minHeight={0} flexDirection="column" paddingLeft={2} paddingRight={2} paddingTop={1} gap={1}>
      <TopLogoNav label="DASHBOARD" onSelect={() => route.navigate({ type: "opencodex-dashboard" })} />
      <scrollbox
        flexGrow={1}
        minHeight={0}
        scrollAcceleration={scrollAcceleration()}
        verticalScrollbarOptions={{
          trackOptions: {
            backgroundColor: theme.backgroundElement,
            foregroundColor: theme.border,
          },
        }}
      >
        <box width="100%" maxWidth={promptMaxWidth()} flexDirection="column" gap={1}>
          <box flexDirection="column" gap={0}>
            <text attributes={TextAttributes.BOLD} fg={theme.primary}>{editing() ? "Edit swarm" : "Create swarm"}</text>
            <text fg={theme.textMuted}>{editing() ? "Update the swarm name, orchestrator, and specialist config." : "Pick the project, set the orchestrator first, then select reusable specialist roles."}</text>
          </box>
          <Show when={(projects() ?? []).length > 0} fallback={<EmptyRow text="Create an OpencodeX project before starting a swarm." />}>
            <SwarmCreateRow
              title="Project"
              value={projectID() ? projectTitle(projects() ?? [], projectID()) : "Select project"}
              description="Where this swarm's task sessions will run."
              required={!editing()}
              selected={!editing() && isSelected("project")}
              onSelect={() => {
                if (!editing()) selectProject()
              }}
            />
            <SwarmCreateRow
              title="Title"
              value={title().trim() || "Optional; first task can name the swarm later"}
              selected={isSelected("title")}
              onSelect={() => void editTitle()}
            />
            <Section title="Orchestrator">
              <SwarmCreateRow
                title="Name"
                value={orchestrator().name}
                description="The orchestrator is always the first swarm role."
                required
                selected={isSelected("orchestrator-name")}
                onSelect={() => void editOrchestratorName()}
              />
              <SwarmRoleDraftCard
                role={orchestrator()}
                selected={isSelected("orchestrator-model") || isSelected("orchestrator-instructions")}
                selectedModel={isSelected("orchestrator-model")}
                selectedInstructions={isSelected("orchestrator-instructions")}
                providers={sync.data.provider}
                modelRequired
                onSelect={() => void editInstructions("orchestrator")}
                onModel={() => selectModel("orchestrator")}
                onInstructions={() => void editInstructions("orchestrator")}
              />
            </Section>
            <Section title="Specialists" count={selectedRoles().length} required>
              <Show when={roles().length > 0} fallback={<EmptyRow text="No specialist roles assigned yet." />}>
                <For each={roles()}>
                  {(role) => (
                    <SwarmRoleDraftCard
                      role={role}
                      selected={
                        isSelected(`role:${role.skill}`) ||
                        isSelected(`role-model:${role.skill}`) ||
                        isSelected(`role-instructions:${role.skill}`) ||
                        isSelected(`role-remove:${role.skill}`)
                      }
                      selectedModel={isSelected(`role-model:${role.skill}`)}
                      selectedInstructions={isSelected(`role:${role.skill}`) || isSelected(`role-instructions:${role.skill}`)}
                      selectedRemove={isSelected(`role-remove:${role.skill}`)}
                      providers={sync.data.provider}
                      modelRequired
                      onSelect={() => void editInstructions(role.skill)}
                      onModel={() => selectModel(role.skill)}
                      onInstructions={() => void editInstructions(role.skill)}
                      onRemove={() => removeRole(role.skill)}
                    />
                  )}
                </For>
              </Show>
              <SwarmAddAgentCard selected={isSelected("add-agent")} disabled={availableRoles().length === 0} onSelect={() => void addAgent()} />
            </Section>
            <box flexDirection="column" gap={0}>
              <box
                paddingLeft={1}
                paddingRight={1}
                paddingTop={1}
                paddingBottom={1}
                backgroundColor={theme.backgroundPanel}
                border={["left"]}
                borderColor={isSelected("create") ? theme.primary : theme.success}
                onMouseUp={() => void saveSwarm()}
              >
                <text attributes={TextAttributes.BOLD} fg={creating() ? theme.textMuted : theme.success}>{creating() ? (editing() ? "Saving..." : "Creating...") : (editing() ? "Save swarm" : "Create swarm")}</text>
                <text fg={theme.textMuted}>{editing() ? "Updates this reusable swarm configuration." : "Creates the reusable swarm; assign tasks from the swarm page prompt bar."}</text>
              </box>
              <box
                paddingLeft={1}
                paddingRight={1}
                paddingTop={1}
                paddingBottom={1}
                backgroundColor={theme.backgroundPanel}
                border={["left"]}
                borderColor={isSelected("cancel") ? theme.primary : theme.textMuted}
                onMouseUp={cancelCreate}
              >
                <text attributes={TextAttributes.BOLD} fg={theme.text}>Cancel</text>
                <text fg={theme.textMuted}>{editing() ? "Return to this swarm without saving changes." : "Return to swarms without creating this swarm."}</text>
              </box>
            </box>
          </Show>
        </box>
      </scrollbox>
      <text fg={theme.textMuted}>Use arrows or j/k to move, tab to cycle, enter to edit, esc to cancel.</text>
      <Toast />
    </box>
  )
}

export function OpencodeXSwarms() {
  const sdk = useSDK()
  const sync = useSync()
  const route = useRoute()
  const dialog = useDialog()
  const { theme } = useTheme()
  const promptRef = usePromptRef()
  const dimensions = useTerminalDimensions()
  const tuiConfig = useTuiConfig()
  const [, setOxSidebarOpen] = useOxSidebar()
  const [refresh, setRefresh] = createSignal(0)
  const [selected, setSelected] = createSignal(0)
  const [selectedRunID, setSelectedRunID] = createSignal("new")
  const [activeCollapsed, setActiveCollapsed] = createSignal(false)
  const [inactiveCollapsed, setInactiveCollapsed] = createSignal(false)
  const [projects] = createResource(refresh, () => sdk.request<OpencodeXProject[]>("/experimental/opencodex/project"))
  const [swarms, { refetch }] = createResource(refresh, () => sdk.request<OpencodeXSwarm[]>("/experimental/opencodex/swarm"))
  const promptMaxWidth = createMemo(() => {
    const configured = tuiConfig.prompt?.max_width
    if (configured === "auto") return Math.max(75, Math.floor(dimensions().width * 0.7))
    return configured ?? 75
  })
  const cardWidth = createMemo(() => {
    if (dimensions().width >= 150) return 42
    if (dimensions().width >= 110) return 38
    return 34
  })
  const scrollAcceleration = createMemo(() => getScrollAcceleration(tuiConfig))
  const displaySwarmStatus = (swarm: OpencodeXSwarm) => {
    const active = swarmRuns(swarm).find((run) => {
      const sessionID = swarmRunSessionID(run)
      if (!sessionID) return false
      return deriveStatus(sessionID, sync) !== "dormant"
    })
    if (active) return taskStatus(active)
    const run = currentSwarmRun(swarm)
    const sessionID = run ? swarmRunSessionID(run) : undefined
    if (sessionID && deriveStatus(sessionID, sync) === "dormant") return "dormant"
    const status = swarmDisplayStatus(swarm)
    return status === "running" ? "dormant" : status
  }
  const active = createMemo(() =>
    (swarms() ?? [])
      .filter((swarm) => isActiveSwarm(displaySwarmStatus(swarm)))
      .toSorted((a, b) => swarmDisplayTimeUpdated(b) - swarmDisplayTimeUpdated(a))
  )
  const inactive = createMemo(() =>
    (swarms() ?? [])
      .filter((swarm) => !isActiveSwarm(displaySwarmStatus(swarm)))
      .toSorted((a, b) => swarmDisplayTimeUpdated(b) - swarmDisplayTimeUpdated(a))
  )
  const list = createMemo(() => [...active(), ...inactive()])
  const visibleList = createMemo(() => [
    ...(activeCollapsed() ? [] : active()),
    ...(inactiveCollapsed() ? [] : inactive()),
  ])
  const current = createMemo(() => {
    const byRoute = (swarms() ?? []).find((swarm) => route.data.type === "opencodex-swarms" && swarm.id === route.data.swarmID)
    return byRoute
  })
  const promptTarget = createMemo(() => current() ?? visibleList()[selected()] ?? list()[0])
  const currentRuns = createMemo(() => {
    const swarm = current()
    if (!swarm) return []
    return swarmRuns(swarm)
  })
  const previousSwarmShortcut = useCommandShortcut("opencodex.swarm.route.up")
  const nextSwarmShortcut = useCommandShortcut("opencodex.swarm.route.down")
  const createSwarmShortcut = useCommandShortcut("opencodex.swarm.route.create")
  const dashboardShortcut = useCommandShortcut("opencodex.swarm.route.dashboard")
  const refreshShortcut = useCommandShortcut("opencodex.swarm.route.refresh")
  const shortcutHint = createMemo(() => {
    const select = [previousSwarmShortcut(), nextSwarmShortcut()].filter(Boolean).join("/")
    return [
      select && `${select} select`,
      createSwarmShortcut() && `${createSwarmShortcut()} ${route.data.type === "opencodex-swarms" && route.data.swarmID ? "new task" : "create"}`,
      dashboardShortcut() && `${dashboardShortcut()} dashboard`,
      refreshShortcut() && `${refreshShortcut()} refresh`,
    ].filter(Boolean).join("  ")
  })
  const detailMaxWidth = createMemo(() => Math.min(promptMaxWidth(), 88))
  const bindPrompt = (ref: PromptRef | undefined) => {
    promptRef.set(ref)
  }

  createEffect(() => {
    if (route.data.type === "opencodex-swarms" && !route.data.swarmID) route.navigate({ type: "opencodex-dashboard" })
  })

  createEffect(() => {
    if (selected() >= visibleList().length) setSelected(Math.max(0, visibleList().length - 1))
  })

  createEffect(() => {
    if (selectedRunID() === "new") return
    if (!currentRuns().some((run) => run.id === selectedRunID())) setSelectedRunID("new")
  })

  onMount(() => {
    setOxSidebarOpen(true)
    const timer = setInterval(() => setRefresh((value) => value + 1), 2500)
    onCleanup(() => clearInterval(timer))
  })

  async function startRun(prompt: { input: string }) {
    const swarm = promptTarget()
    if (!swarm) {
      await DialogAlert.show(dialog, "Assign Task", "Create a swarm before assigning a task.")
      return false
    }
    if (swarm.status === "cancelled") {
      await DialogAlert.show(dialog, "Assign Task", "Cancelled swarms cannot accept new tasks.")
      return false
    }
    const runPrompt = prompt.input.trim()
    if (!runPrompt) return false
    const updated = await sdk
      .request<OpencodeXSwarm>(`/experimental/opencodex/swarm/${swarm.id}/task`, {
        method: "POST",
        body: JSON.stringify({ prompt: runPrompt }),
      })
      .catch((error: Error) => {
        void DialogAlert.show(dialog, "Assign Task", error.message)
      })
    if (!updated) return false
    setRefresh((value) => value + 1)
    void refetch()
    route.navigate({ type: "opencodex-swarms", swarmID: updated.id })
    return true
  }

  function select(offset: number) {
    if (route.data.type === "opencodex-swarms" && route.data.swarmID) {
      const options = ["new", ...currentRuns().map((run) => run.id)]
      const index = Math.max(0, options.indexOf(selectedRunID()))
      setSelectedRunID(options[Math.min(Math.max(index + offset, 0), options.length - 1)] ?? "new")
      return
    }
    if (visibleList().length === 0) return
    const next = Math.min(Math.max(selected() + offset, 0), visibleList().length - 1)
    setSelected(next)
    route.navigate({ type: "opencodex-swarms", swarmID: visibleList()[next]?.id })
  }

  function toggleActive() {
    const next = !activeCollapsed()
    setActiveCollapsed(next)
    if (!next || selected() >= active().length) return
    setSelected(0)
    if (inactive().length > 0) route.navigate({ type: "opencodex-swarms", swarmID: inactive()[0]?.id })
  }

  function toggleInactive() {
    const next = !inactiveCollapsed()
    setInactiveCollapsed(next)
    if (!next || selected() < active().length) return
    setSelected(0)
    if (active().length > 0) route.navigate({ type: "opencodex-swarms", swarmID: active()[0]?.id })
  }

  function newTask(swarm: OpencodeXSwarm | undefined) {
    if (!swarm) return
    setPendingOpencodeXProjectSession(undefined)
    setPendingOpencodeXSwarmTask({ swarmID: swarm.id, title: swarm.title })
    route.navigate({ type: "home" })
  }

  function taskStatus(run: OpencodeXSwarmRun) {
    const sessionID = swarmRunSessionID(run)
    if (!sessionID) return run.status ?? "queued"
    return deriveStatus(sessionID, sync)
  }

  async function openTask(run: OpencodeXSwarmRun) {
    const sessionID = swarmRunSessionID(run)
    if (!sessionID) {
      await DialogAlert.show(dialog, "Open Task", "This task does not have a session yet.")
      return
    }
    route.navigate({ type: "session", sessionID })
  }

  function openSelected() {
    const swarm = current()
    if (!swarm) return
    if (selectedRunID() === "new") {
      newTask(swarm)
      return
    }
    const run = currentRuns().find((item) => item.id === selectedRunID())
    if (run) void openTask(run)
  }

  function createSwarm() {
    route.navigate({ type: "opencodex-swarm-create" })
  }

  function back() {
    route.back({ type: "opencodex-dashboard" })
  }

  function handleEscape() {
    back()
  }

  async function removeSwarm(swarm: OpencodeXSwarm) {
    const confirmed = await DialogConfirm.show(
      dialog,
      "Delete swarm",
      `Delete "${swarm.title}"? This removes the swarm, roles, tasks, and events.`,
      "keep",
    )
    if (confirmed !== true) return
    const removed = await sdk
      .request<boolean>(`/experimental/opencodex/swarm/${swarm.id}`, { method: "DELETE" })
      .catch((error: Error) => {
        void DialogAlert.show(dialog, "Delete Swarm", error.message)
      })
    if (!removed) return
    setRefresh((value) => value + 1)
    void refetch()
    back()
  }

  useBindings(() => ({
    enabled: route.data.type === "opencodex-swarms",
    commands: [
      {
        name: "opencodex.swarm.route.up",
        title: "Select previous swarm",
        category: "OpencodeX",
        run: () => select(-1),
      },
      {
        name: "opencodex.swarm.route.down",
        title: "Select next swarm",
        category: "OpencodeX",
        run: () => select(1),
      },
      {
        name: "opencodex.swarm.route.open",
        title: route.data.type === "opencodex-swarms" && route.data.swarmID ? "Open selected task" : "Open selected swarm",
        category: "OpencodeX",
        run: () => {
          if (route.data.type === "opencodex-swarms" && route.data.swarmID) {
            openSelected()
            return
          }
          const swarm = current() ?? visibleList()[selected()]
          if (swarm) route.navigate({ type: "opencodex-swarms", swarmID: swarm.id })
        },
      },
      {
        name: "opencodex.swarm.route.create",
        title: route.data.type === "opencodex-swarms" && route.data.swarmID ? "New task" : "Create swarm",
        category: "OpencodeX",
        run: () => {
          if (route.data.type === "opencodex-swarms" && route.data.swarmID) {
            newTask(current())
            return
          }
          createSwarm()
        },
      },
      {
        name: "opencodex.swarm.route.back",
        title: "Back",
        category: "OpencodeX",
        run: back,
      },
      {
        name: "opencodex.swarm.route.dashboard",
        title: "Open dashboard",
        category: "OpencodeX",
        run: () => route.navigate({ type: "opencodex-dashboard" }),
      },
      {
        name: "opencodex.swarm.route.refresh",
        title: "Refresh swarms",
        category: "OpencodeX",
        run: () => setRefresh((value) => value + 1),
      },
    ],
    bindings: [
      ...tuiConfig.keybinds.gather("opencodex.swarm.route", swarmRouteBindingCommands),
      { key: "up,k", desc: "Select previous", group: "OpencodeX", cmd: () => select(-1) },
      { key: "down,j", desc: "Select next", group: "OpencodeX", cmd: () => select(1) },
      {
        key: "return,space",
        desc: route.data.type === "opencodex-swarms" && route.data.swarmID ? "Open selected task" : "Open selected swarm",
        group: "OpencodeX",
        cmd: () => {
          if (route.data.type === "opencodex-swarms" && route.data.swarmID) {
            openSelected()
            return
          }
          const swarm = current() ?? visibleList()[selected()]
          if (swarm) route.navigate({ type: "opencodex-swarms", swarmID: swarm.id })
        },
      },
      ...(route.data.type === "opencodex-swarms" && route.data.swarmID
        ? [
            { key: "escape", desc: "Back to previous page", group: "OpencodeX", cmd: handleEscape },
          ]
        : []),
    ],
  }))

  return (
    <Switch>
      <Match when={route.data.type === "opencodex-swarm-create"}>
        <OpencodeXSwarmCreate />
      </Match>
      <Match when={true}>
    <box flexGrow={1} minHeight={0} flexDirection="column" paddingLeft={2} paddingRight={2} paddingTop={1} gap={1}>
      <box flexGrow={1} minHeight={0} flexDirection="column" gap={1}>
        <TopLogoNav
          label="DASHBOARD"
          onSelect={() => {
            if (route.data.type === "opencodex-swarms" && route.data.swarmID) route.navigate({ type: "opencodex-dashboard" })
            else route.navigate({ type: "opencodex-dashboard" })
          }}
        />
        <scrollbox
          flexGrow={1}
          minHeight={0}
          scrollAcceleration={scrollAcceleration()}
          verticalScrollbarOptions={{
            trackOptions: {
              backgroundColor: theme.backgroundElement,
              foregroundColor: theme.border,
            },
          }}
        >
          <Show when={!(route.data.type === "opencodex-swarms" && route.data.swarmID)}>
            <Show when={list().length > 0} fallback={<SwarmEmptyState width={detailMaxWidth()} onCreate={createSwarm} />}>
              <Section
                title="Active swarms"
                count={active().length}
                collapsible
                collapsed={activeCollapsed()}
                onToggle={toggleActive}
              >
                <Show when={active().length > 0} fallback={<EmptyRow text="No active swarms." />}>
                  <CardGrid>
                    <For each={active()}>
                      {(swarm) => <SwarmCard swarm={swarm} projects={projects() ?? []} width={cardWidth()} displayStatus={displaySwarmStatus(swarm)} />}
                    </For>
                  </CardGrid>
                </Show>
              </Section>

              <Section
                title="Inactive swarms"
                count={inactive().length}
                collapsible
                collapsed={inactiveCollapsed()}
                onToggle={toggleInactive}
              >
                <Show when={inactive().length > 0} fallback={<EmptyRow text="No inactive swarms." />}>
                  <CardGrid>
                    <For each={inactive()}>
                      {(swarm) => <SwarmCard swarm={swarm} projects={projects() ?? []} width={cardWidth()} displayStatus={displaySwarmStatus(swarm)} />}
                    </For>
                  </CardGrid>
                </Show>
              </Section>
            </Show>
          </Show>

          <Show when={route.data.type === "opencodex-swarms" && route.data.swarmID}>
            <Section title="Swarm">
              <Show when={current()} fallback={<EmptyRow text="Swarm not found." />}>
                {(swarm) => (
                  <CardGrid>
                    <box
                      width={Math.min(detailMaxWidth(), 52)}
                      flexShrink={0}
                      flexDirection="column"
                      gap={0}
                      paddingLeft={1}
                      paddingRight={1}
                      paddingTop={1}
                      paddingBottom={1}
                      backgroundColor={theme.backgroundPanel}
                      border={["left"]}
                      borderColor={statusColor(displaySwarmStatus(swarm()), theme)}
                    >
                      <box width="100%" flexDirection="row" justifyContent="space-between">
                        <box flexDirection="row" gap={1}>
                          <text fg={statusColor(displaySwarmStatus(swarm()), theme)}>{statusDot(displaySwarmStatus(swarm()))}</text>
                          <text attributes={TextAttributes.BOLD} fg={theme.text}>{truncate(swarm().title, 62)}</text>
                        </box>
                        <box flexDirection="row" gap={2}>
                          <text
                            fg={theme.primary}
                            onMouseUp={() => route.navigate({ type: "opencodex-swarm-create", swarmID: swarm().id })}
                          >
                            edit
                          </text>
                          <text fg={theme.error} onMouseUp={() => void removeSwarm(swarm())}>
                            delete
                          </text>
                        </box>
                      </box>
                      <text fg={theme.textMuted}>
                        {projectTitle(projects() ?? [], swarm().projectID)} - {swarmRunLabel(swarm())} - {timeAgo(swarmDisplayTimeUpdated(swarm()))}
                      </text>
                      <text fg={swarmDisplayPrompt(swarm()) ? theme.text : theme.textMuted}>
                        {swarmDisplayPrompt(swarm()) ? truncate(swarmDisplayPrompt(swarm()), 48) : "No tasks yet."}
                      </text>
                    </box>
                    <SwarmNewTaskCard
                      width={cardWidth()}
                      selected={selectedRunID() === "new"}
                      onSelect={() => newTask(swarm())}
                    />
                  </CardGrid>
                )}
              </Show>
            </Section>
            <Section title="Team" count={current()?.roles.length} collapsible>
              <Show when={current()} fallback={<EmptyRow text="Swarm not found." />}>
                {(swarm) => (
                  <Show when={swarm().roles.length > 0} fallback={<EmptyRow text="No roles assigned to this swarm." />}>
                    <CardGrid>
                      <For each={swarm().roles}>
                        {(role) => <SwarmAgentCard role={role} width={cardWidth()} lead={isOrchestratorSwarmRole(role)} />}
                      </For>
                    </CardGrid>
                  </Show>
                )}
              </Show>
            </Section>
            <Section
              title="Tasks"
              count={currentRuns().length}
              collapsible
              action={{ label: "+ New Task", onSelect: () => newTask(current()) }}
            >
              <Show when={current()} fallback={<EmptyRow text="Swarm not found." />}>
                <Show when={currentRuns().length > 0} fallback={<EmptyRow text="No tasks assigned yet." />}>
                  <CardGrid>
                    <For each={currentRuns()}>
                      {(run) => (
                        <SwarmTaskCard
                          run={run}
                          status={taskStatus(run)}
                          width={cardWidth()}
                          selected={selectedRunID() === run.id}
                          onSelect={() => void openTask(run)}
                        />
                      )}
                    </For>
                  </CardGrid>
                </Show>
              </Show>
            </Section>
          </Show>
        </scrollbox>
      </box>
      <Show when={shortcutHint()}>
        <text fg={theme.textMuted}>{shortcutHint()}</text>
      </Show>
      <Show when={route.data.type === "opencodex-swarms" && !route.data.swarmID}>
        <box width="100%" zIndex={1000} paddingTop={1} flexShrink={0} alignItems="center">
          <box width="100%" maxWidth={promptMaxWidth()}>
            <Prompt
              ref={bindPrompt}
              draftKey={`opencodex-swarm:${promptTarget()?.id ?? "none"}`}
              onCustomSubmit={startRun}
              placeholders={swarmRunPlaceholder}
              targetLabel={promptTarget()?.title ?? "No swarm selected"}
            />
          </box>
        </box>
      </Show>
      <Toast />
    </box>
      </Match>
    </Switch>
  )
}
