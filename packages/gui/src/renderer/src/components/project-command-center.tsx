import { For, Show, createEffect, createMemo, createSignal, on, type JSX } from "solid-js"
import { clientWorkItemBucket, type AttentionItem, type WorkItem } from "@opencode-ai/sdk/v2/work-item"
import type { OpencodeXTerminalSession, Session } from "@opencode-ai/sdk/v2/client"
import { formatRelative, title } from "../lib/format"
import { projectSessions, sessionOrderBucket, type SessionOrderState } from "../lib/app-session-lists"
import { projectViewSessionCount, projectViews, summarizeProjects } from "../lib/project-summary"
import { deriveViewStatus, sessionStatusLabel } from "../lib/session-status"
import type { GuiSnapshot } from "../lib/session-api"
import { isRecentSessionUpdate, SessionCardBucket } from "./session-card-list"
import { Button } from "./ui"
import { AttentionQueue } from "./attention-queue"
import { SidebarSessionLink, SidebarTerminalSessionLink } from "./rail-sidebar-links"
import { ProjectHomeHeader } from "./project-home-header"
import { ProjectOverviewTiles } from "./project-overview-tiles"

/** Prior sessions arrive in pages so a long-lived project does not render hundreds of cards. */
const PRIOR_PAGE_SIZE = 12

/** One list, two runtimes: chat sessions and Claude Code terminals ride together. */
type ProjectWorkItem =
  | { kind: "session"; session: Session; updated: number }
  | { kind: "terminal"; terminalSession: OpencodeXTerminalSession; updated: number }

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
  renameSession: (session: Session) => void
  deleteSession: (session: Session) => void
  renameTerminalSession: (terminalSession: OpencodeXTerminalSession) => void
  removeTerminalSession: (terminalSession: OpencodeXTerminalSession) => void
  sessionPinned: (sessionID: string) => boolean
  toggleSessionPinned: (sessionID: string) => void
  terminalStatus: (terminalSessionID: string) => string
}) {
  const [sessionBucketsCollapsed, setSessionBucketsCollapsed] = createSignal<Record<string, boolean>>({ prior: true })
  const [priorPages, setPriorPages] = createSignal(1)
  // The component instance survives switching projects, so paging starts over.
  createEffect(on(() => props.project.id, () => setPriorPages(1), { defer: true }))
  const summary = createMemo(() => summarizeProjects({
    projects: [props.project],
    snapshot: props.snapshot,
    state: props.sessionOrderState,
  })[0])
  const sessions = createMemo(() => projectSessions(props.project, props.snapshot, props.sessionOrderState))
  const workBySessionID = createMemo(() => new Map(props.workItems.filter((item) => item.kind === "session" && item.sessionID).map((item) => [item.sessionID!, item])))
  const attention = createMemo(() => props.attentionItems.filter((item) => item.projectID === props.project.id))
  const attentionSessionIDs = createMemo(() => new Set(attention().flatMap((item) => item.sessionID ? [item.sessionID] : [])))
  const sessionIsRecent = (session: Session) => {
    const item = workBySessionID().get(session.id)
    const bucket = item ? clientWorkItemBucket(item) : sessionOrderBucket(props.snapshot, session)
    return bucket !== "inactive" || isRecentSessionUpdate(session.time.updated)
  }
  const terminalIsRecent = (terminalSession: OpencodeXTerminalSession) => {
    const status = props.terminalStatus(terminalSession.id)
    return status === "running" || status === "starting" || isRecentSessionUpdate(Number(terminalSession.timeUpdated))
  }
  const workItems = createMemo<ProjectWorkItem[]>(() => [
    ...sessions()
      .filter((session) => !attentionSessionIDs().has(session.id))
      .map((session) => ({ kind: "session" as const, session, updated: session.time.updated })),
    ...props.project.terminalSessions
      .map((terminalSession) => ({ kind: "terminal" as const, terminalSession, updated: Number(terminalSession.timeUpdated) })),
  ].sort((a, b) => b.updated - a.updated))
  const recentItems = createMemo(() => workItems().filter((item) => item.kind === "session" ? sessionIsRecent(item.session) : terminalIsRecent(item.terminalSession)))
  const priorItems = createMemo(() => workItems().filter((item) => item.kind === "session" ? !sessionIsRecent(item.session) : !terminalIsRecent(item.terminalSession)))
  const visiblePriorItems = createMemo(() => priorItems().slice(0, priorPages() * PRIOR_PAGE_SIZE))
  const views = createMemo(() => projectViews(props.project, props.snapshot, props.sessionOrderState))
  const toggleSessionBucket = (name: string) => setSessionBucketsCollapsed((value) => ({ ...value, [name]: !value[name] }))

  return (
    <div class="page project-command-page">
      <ProjectHomeHeader
        summary={summary()}
        back={props.back}
        createSession={props.createSession}
        launchClaudeSession={props.launchClaudeSession}
        editProject={props.editProject}
        deleteProject={props.deleteProject}
      />

      <section class="project-home-layout">
        <div class="project-home-main">
          <AttentionQueue items={attention()} openSession={props.openSession} openSwarm={props.openSwarm} empty="No work needs your attention." />

          <div class="dashboard-session-groups">
            <SessionCardBucket title="Recent Sessions" count={recentItems().length} empty="No recent sessions." collapsed={sessionBucketsCollapsed().recent} onToggle={() => toggleSessionBucket("recent")}>
              <For each={recentItems()}>
                {(item) => <ProjectWorkItemCard item={item} {...cardProps()} />}
              </For>
            </SessionCardBucket>

            <SessionCardBucket title="Prior Sessions" count={priorItems().length} empty="No prior sessions." collapsed={sessionBucketsCollapsed().prior} onToggle={() => toggleSessionBucket("prior")}>
              <For each={visiblePriorItems()}>
                {(item) => <ProjectWorkItemCard item={item} {...cardProps()} />}
              </For>
              <Show when={visiblePriorItems().length < priorItems().length}>
                <Button appearance="ghost" class="project-home-show-more" onClick={() => setPriorPages((value) => value + 1)}>
                  Show {Math.min(PRIOR_PAGE_SIZE, priorItems().length - visiblePriorItems().length)} more
                  <small>{visiblePriorItems().length} of {priorItems().length}</small>
                </Button>
              </Show>
            </SessionCardBucket>
          </div>
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

  function cardProps() {
    return {
      snapshot: props.snapshot,
      openSession: props.openSession,
      openTerminalSession: props.openTerminalSession,
      terminalStatus: props.terminalStatus,
      renameSession: props.renameSession,
      deleteSession: props.deleteSession,
      renameTerminalSession: props.renameTerminalSession,
      removeTerminalSession: props.removeTerminalSession,
      sessionPinned: props.sessionPinned,
      toggleSessionPinned: props.toggleSessionPinned,
    }
  }
}

/** Exactly the dashboard's session rows, fed from whichever runtime the item ran in. */
function ProjectWorkItemCard(props: {
  item: ProjectWorkItem
  snapshot?: GuiSnapshot
  openSession: (sessionID: string) => void
  openTerminalSession: (terminalSessionID: string) => void
  terminalStatus: (terminalSessionID: string) => string
  renameSession: (session: Session) => void
  deleteSession: (session: Session) => void
  renameTerminalSession: (terminalSession: OpencodeXTerminalSession) => void
  removeTerminalSession: (terminalSession: OpencodeXTerminalSession) => void
  sessionPinned: (sessionID: string) => boolean
  toggleSessionPinned: (sessionID: string) => void
}) {
  return (
    <Show
      when={props.item.kind === "session" ? props.item.session : undefined}
      fallback={
        <Show when={props.item.kind === "terminal" ? props.item.terminalSession : undefined}>
          {(terminalSession) => (
            <SidebarTerminalSessionLink
              terminalSession={terminalSession()}
              status={props.terminalStatus(terminalSession().id)}
              active={false}
              pinned={props.sessionPinned(terminalSession().id)}
              onClick={() => props.openTerminalSession(terminalSession().id)}
              togglePinned={() => props.toggleSessionPinned(terminalSession().id)}
              renameSession={() => props.renameTerminalSession(terminalSession())}
              removeSession={() => props.removeTerminalSession(terminalSession())}
            />
          )}
        </Show>
      }
    >
      {(session) => (
        <SidebarSessionLink
          session={session()}
          snapshot={props.snapshot}
          active={false}
          pinned={props.sessionPinned(session().id)}
          onClick={() => props.openSession(session().id)}
          togglePinned={() => props.toggleSessionPinned(session().id)}
          renameSession={() => props.renameSession(session())}
          deleteSession={() => props.deleteSession(session())}
        />
      )}
    </Show>
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
          <Show
            when={model.swarmID}
            fallback={
              <div class="project-home-row">
                <ProjectModelRowBody model={model} />
              </div>
            }
          >
            {(swarmID) => (
              <Button appearance="ghost" class="project-home-row" onClick={() => props.openSwarm(swarmID())}>
                <ProjectModelRowBody model={model} />
              </Button>
            )}
          </Show>
        )}
      </For>
    </ProjectHomePanel>
  )
}

function ProjectModelRowBody(props: { model: { label: string; providerID: string; count: number; swarmID?: string } }) {
  return (
    <span>
      <strong>{props.model.label}</strong>
      <span>{props.model.swarmID ? "swarm" : props.model.providerID} - {props.model.count} {props.model.count === 1 ? "session" : "sessions"}</span>
    </span>
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
