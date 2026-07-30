import { For, Show, createMemo, createSignal, type JSX } from "solid-js"
import { clientWorkItemBucket, type AttentionItem, type WorkItem } from "@opencode-ai/sdk/v2/work-item"
import { formatRelative, title } from "../lib/format"
import { projectSessions, sessionOrderBucket, type SessionOrderState } from "../lib/app-session-lists"
import { projectViewSessionCount, projectViews, summarizeProjects } from "../lib/project-summary"
import { deriveViewStatus, sessionStatusLabel } from "../lib/session-status"
import type { GuiSnapshot } from "../lib/session-api"
import { isRecentSessionUpdate, SessionCardBucket, SessionStatusCard } from "./session-card-list"
import { Button } from "./ui"
import { AttentionQueue } from "./attention-queue"
import { ProjectClaudeSection } from "./project-claude-section"
import { ProjectHomeHeader } from "./project-home-header"
import { ProjectOverviewTiles } from "./project-overview-tiles"

/** Prior sessions arrive in pages so a long-lived project does not render hundreds of cards. */
const PRIOR_PAGE_SIZE = 12

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
  launchClaudeSession: (projectID: string, directory: string) => void
  editProject: (projectID: string, currentName: string, folders: string[]) => void
  deleteProject: (projectID: string, name: string) => void
  sessionPinned: (sessionID: string) => boolean
  toggleSessionPinned: (sessionID: string) => void
  terminalStatus: (terminalSessionID: string) => string
}) {
  const [sessionBucketsCollapsed, setSessionBucketsCollapsed] = createSignal<Record<string, boolean>>({ prior: true })
  const [priorPages, setPriorPages] = createSignal(1)
  const summary = createMemo(() => summarizeProjects({
    projects: [props.project],
    snapshot: props.snapshot,
    state: props.sessionOrderState,
  })[0])
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
  const visiblePriorSessions = createMemo(() => priorSessions().slice(0, priorPages() * PRIOR_PAGE_SIZE))
  const views = createMemo(() => projectViews(props.project, props.snapshot, props.sessionOrderState))
  const primaryFolder = createMemo(() => props.project.folders[0]?.path)
  const terminalSessions = createMemo(() => [...props.project.terminalSessions].sort((a, b) => Number(b.timeUpdated) - Number(a.timeUpdated)))
  const toggleSessionBucket = (name: string) => setSessionBucketsCollapsed((value) => ({ ...value, [name]: !value[name] }))

  return (
    <div class="page project-command-page">
      <ProjectHomeHeader
        summary={summary()}
        back={props.back}
        createSession={props.createSession}
        editProject={props.editProject}
        deleteProject={props.deleteProject}
      />

      <section class="project-home-layout">
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
              <For each={visiblePriorSessions()}>
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
              <Show when={visiblePriorSessions().length < priorSessions().length}>
                <Button appearance="ghost" class="project-home-show-more" onClick={() => setPriorPages((value) => value + 1)}>
                  Show {Math.min(PRIOR_PAGE_SIZE, priorSessions().length - visiblePriorSessions().length)} more
                  <small>{visiblePriorSessions().length} of {priorSessions().length}</small>
                </Button>
              </Show>
            </SessionCardBucket>
          </div>

          <ProjectClaudeSection
            sessions={terminalSessions()}
            directory={primaryFolder()}
            terminalStatus={props.terminalStatus}
            openSession={props.openTerminalSession}
            launchSession={() => {
              const directory = primaryFolder()
              if (directory) props.launchClaudeSession(props.project.id, directory)
            }}
            sessionPinned={props.sessionPinned}
            toggleSessionPinned={props.toggleSessionPinned}
          />
        </div>

        <aside class="project-home-sidebar">
          <ProjectOverviewTiles summaries={[summary()]} filter="all" setFilter={() => {}} readOnly />

          <ProjectHomePanel title="Views" count={views().length} empty="No views include this project.">
            <For each={views().slice(0, 8)}>
              {(view) => (
                <Button
                  appearance="ghost"
                  class="project-home-row"
                  classList={{ [`status-${deriveViewStatus(view, props.snapshot).replaceAll("_", "-")}`]: true }}
                  onClick={() => props.openView(view.id)}
                >
                  <span class="view-status-dot" aria-label={sessionStatusLabel(deriveViewStatus(view, props.snapshot))} />
                  <span>
                    <strong>{title(view.title)}</strong>
                    <span>{projectViewSessionCount(view)} panes - {formatRelative(view.timeUpdated)}</span>
                  </span>
                </Button>
              )}
            </For>
          </ProjectHomePanel>

          <ProjectModelsPanel project={props.project} snapshot={props.snapshot} openSwarm={props.openSwarm} />
        </aside>
      </section>
    </div>
  )
}

/**
 * What this project actually runs on, counted from its sessions. Swarms show up
 * here the way they show up everywhere else now: as a model you can pick.
 */
function ProjectModelsPanel(props: {
  project: GuiSnapshot["projects"][number]
  snapshot?: GuiSnapshot
  openSwarm: (swarmID: string) => void
}) {
  const models = createMemo(() => {
    const counts = new Map<string, { providerID: string; modelID: string; label: string; count: number; swarmID?: string }>()
    for (const session of props.project.sessions ?? []) {
      const model = session.model
      if (!model) continue
      const key = `${model.providerID}/${model.id}`
      const swarm = model.providerID === "swarm"
        ? (props.snapshot?.swarms ?? []).find((item) => item.id === model.id)
        : undefined
      const entry = counts.get(key) ?? {
        providerID: model.providerID,
        modelID: model.id,
        label: swarm ? title(swarm.title) : model.id,
        count: 0,
        swarmID: swarm?.id,
      }
      entry.count += 1
      counts.set(key, entry)
    }
    return [...counts.values()].sort((a, b) => b.count - a.count).slice(0, 6)
  })

  return (
    <ProjectHomePanel title="Models" count={models().length} empty="No sessions have run here yet.">
      <For each={models()}>
        {(model) => (
          <Button
            appearance="ghost"
            class="project-home-row"
            disabled={!model.swarmID}
            onClick={() => model.swarmID && props.openSwarm(model.swarmID)}
          >
            <span>
              <strong>{model.label}</strong>
              <span>{model.swarmID ? "swarm" : model.providerID} - {model.count} {model.count === 1 ? "session" : "sessions"}</span>
            </span>
          </Button>
        )}
      </For>
    </ProjectHomePanel>
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
