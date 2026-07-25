import { For, Show, createMemo, createSignal, type JSX } from "solid-js"
import { clientWorkItemBucket, type AttentionItem, type WorkItem } from "@opencode-ai/sdk/v2/work-item"
import { compactPath, formatRelative, title } from "../lib/format"
import { projectSessions, sessionOrderBucket, type SessionOrderState } from "../lib/app-session-lists"
import { projectSwarms, projectViewSessionCount, projectViews } from "../lib/project-summary"
import type { GuiSnapshot } from "../lib/store"
import { isRecentSessionUpdate, SessionCardBucket, SessionStatusCard, TerminalSessionStatusCard } from "./session-card-list"
import { Button } from "./ui"
import { projectLabel } from "./project-directory"
import { CardActionMenu } from "./card-action-menu"
import { AttentionQueue } from "./attention-queue"

export function ProjectCommandCenter(props: {
  project: GuiSnapshot["projects"][number]
  snapshot?: GuiSnapshot
  workItems: WorkItem[]
  attentionItems: AttentionItem[]
  sessionOrderState?: SessionOrderState
  back: () => void
  openSession: (sessionID: string) => void
  openTerminalSession: (terminalSessionID: string) => void
  openView: (viewID: string) => void
  openSwarm: (swarmID: string) => void
  createSession: (projectID?: string, directory?: string) => void
  createTerminalSession: (projectID?: string, directory?: string) => void
  createSwarm: (projectID: string) => void
  editProject: (projectID: string, currentName: string, folders: string[]) => void
  deleteProject: (projectID: string, name: string) => void
  sessionPinned: (sessionID: string) => boolean
  toggleSessionPinned: (sessionID: string) => void
  terminalStatus: (terminalSessionID: string) => string
}) {
  const [sessionBucketsCollapsed, setSessionBucketsCollapsed] = createSignal<Record<string, boolean>>({ prior: true })
  const sessions = createMemo(() => projectSessions(props.project, props.snapshot, props.sessionOrderState))
  const workBySessionID = createMemo(() => new Map(props.workItems.filter((item) => item.kind === "session" && item.sessionID).map((item) => [item.sessionID!, item])))
  const attention = createMemo(() => props.attentionItems.filter((item) => item.projectID === props.project.id))
  const attentionSessionIDs = createMemo(() => new Set(attention().flatMap((item) => item.sessionID ? [item.sessionID] : [])))
  const bucket = (session: ReturnType<typeof sessions>[number]) => {
    const item = workBySessionID().get(session.id)
    return item ? clientWorkItemBucket(item) : sessionOrderBucket(props.snapshot, session)
  }
  const recentSessions = createMemo(() => sessions().filter((session) => !attentionSessionIDs().has(session.id) && (bucket(session) !== "inactive" || isRecentSessionUpdate(session.time.updated))))
  const priorSessions = createMemo(() => sessions().filter((session) => !attentionSessionIDs().has(session.id) && bucket(session) === "inactive" && !isRecentSessionUpdate(session.time.updated)))
  const swarms = createMemo(() => projectSwarms(props.project, props.snapshot))
  const views = createMemo(() => projectViews(props.project, props.snapshot))
  const primaryFolder = createMemo(() => props.project.folders[0]?.path)
  const terminalSessions = createMemo(() => [...props.project.terminalSessions].sort((a, b) => Number(b.timeUpdated) - Number(a.timeUpdated)))
  const projectName = () => projectLabel(props.project)
  const projectActions = () => [
    { label: "Create swarm", icon: "swarm" as const, onSelect: () => props.createSwarm(props.project.id) },
    { label: "Edit project", icon: "pencil" as const, onSelect: () => props.editProject(props.project.id, projectName(), props.project.folders.map((folder) => folder.path)) },
    { label: "Delete project", icon: "trash" as const, danger: true, onSelect: () => props.deleteProject(props.project.id, projectName()) },
  ]
  const toggleSessionBucket = (bucket: string) => setSessionBucketsCollapsed((value) => ({ ...value, [bucket]: !value[bucket] }))

  return (
    <div class="page project-command-page">
      <header class="project-home-header">
        <div>
          <Button size="compact" appearance="ghost" icon="chevronLeft" onClick={props.back}>Projects</Button>
          <p class="eyebrow">Project home</p>
          <h1>{projectName()}</h1>
          <div class="project-home-folder-strip">
            <For each={props.project.folders} fallback={<span>No folders selected</span>}>
              {(folder) => <span title={folder.path}>{compactPath(folder.path)}</span>}
            </For>
          </div>
        </div>
        <div class="project-home-actions">
          <Button appearance="solid" tone="accent" icon="session" onClick={() => props.createSession(props.project.id, primaryFolder())}>New session</Button>
          <Button appearance="outline" onClick={() => props.createTerminalSession(props.project.id, primaryFolder())}>Claude Code</Button>
          <CardActionMenu label={projectName()} actions={projectActions()} />
        </div>
      </header>

      <section class="project-home-layout project-home-layout-single">
        <div class="project-home-main">
          <AttentionQueue items={attention()} openSession={props.openSession} openSwarm={props.openSwarm} empty="No work needs your attention." />

          <div class="dashboard-session-groups">
            <SessionCardBucket title="Recent Sessions" count={recentSessions().length} empty="No recent sessions." collapsed={sessionBucketsCollapsed().recent} onToggle={() => toggleSessionBucket("recent")}>
              <For each={recentSessions()}>
                {(session) => (
                  <SessionStatusCard
                    session={session}
                    snapshot={props.snapshot}
                    openSession={props.openSession}
                    pinned={props.sessionPinned(session.id)}
                    togglePinned={() => props.toggleSessionPinned(session.id)}
                  />
                )}
              </For>
            </SessionCardBucket>

            <SessionCardBucket title="Prior Sessions" count={priorSessions().length} empty="No prior sessions." collapsed={sessionBucketsCollapsed().prior} onToggle={() => toggleSessionBucket("prior")}>
              <For each={priorSessions()}>
                {(session) => (
                  <SessionStatusCard
                    session={session}
                    snapshot={props.snapshot}
                    openSession={props.openSession}
                    compact
                    pinned={props.sessionPinned(session.id)}
                    togglePinned={() => props.toggleSessionPinned(session.id)}
                  />
                )}
              </For>
            </SessionCardBucket>

            <SessionCardBucket title="Claude Code" count={terminalSessions().length} empty="No Claude Code sessions." collapsed={sessionBucketsCollapsed().terminal} onToggle={() => toggleSessionBucket("terminal")}>
              <For each={terminalSessions()}>
                {(session) => (
                  <TerminalSessionStatusCard
                    terminalSession={session}
                    status={props.terminalStatus(session.id)}
                    openSession={props.openTerminalSession}
                    pinned={props.sessionPinned(session.id)}
                    togglePinned={() => props.toggleSessionPinned(session.id)}
                  />
                )}
              </For>
            </SessionCardBucket>
          </div>

          <div class="project-home-split">
            <ProjectHomePanel title="Views" count={views().length} empty="No views include this project.">
              <For each={views().slice(0, 8)}>
                {(view) => (
                  <Button appearance="ghost" class="project-home-row" onClick={() => props.openView(view.id)}>
                    <strong>{title(view.title)}</strong>
                    <span>{projectViewSessionCount(view)} sessions - {formatRelative(view.timeUpdated)}</span>
                  </Button>
                )}
              </For>
            </ProjectHomePanel>

            <ProjectHomePanel title="Swarms" count={swarms().length} empty="No swarms for this project.">
              <For each={swarms().slice(0, 8)}>
                {(swarm) => (
                  <Button appearance="ghost" class="project-home-row" onClick={() => props.openSwarm(swarm.id)}>
                    <strong>{title(swarm.title)}</strong>
                    <span>{swarm.roles.length} roles - {swarm.runs.length} runs</span>
                  </Button>
                )}
              </For>
            </ProjectHomePanel>
          </div>
        </div>
      </section>
    </div>
  )

}

function ProjectHomePanel(props: { title: string; count: number; empty: string; children: JSX.Element }) {
  return (
    <section class="project-home-panel">
      <header>
        <strong>{props.title}</strong>
        <small>{props.count}</small>
      </header>
      <div>
        <Show when={props.count > 0} fallback={<div class="empty">{props.empty}</div>}>
          {props.children}
        </Show>
      </div>
    </section>
  )
}
