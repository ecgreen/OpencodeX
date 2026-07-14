import { For, Show, createMemo, createSignal, type JSX } from "solid-js"
import { compactPath, formatRelative, title } from "../lib/format"
import { projectSessions, sessionOrderBucket, type SessionOrderState } from "../lib/app-session-lists"
import { projectAttentionItems, projectSwarms, projectViewSessionCount, projectViews } from "../lib/project-summary"
import { sessionStatusLabel } from "../lib/session-status"
import type { GuiSnapshot } from "../lib/store"
import { isRecentSessionUpdate, SessionCardBucket, SessionStatusCard } from "./session-card-list"
import { Button } from "./ui"
import { projectLabel } from "./project-directory"

export function ProjectCommandCenter(props: {
  project: GuiSnapshot["projects"][number]
  snapshot?: GuiSnapshot
  sessionOrderState?: SessionOrderState
  back: () => void
  openSession: (sessionID: string) => void
  openView: (viewID: string) => void
  openSwarm: (swarmID: string) => void
  createSession: (projectID?: string, directory?: string) => void
  createSwarm: (projectID: string) => void
  editProject: (projectID: string, currentName: string, folders: string[]) => void
  deleteProject: (projectID: string, name: string) => void
  sessionPinned: (sessionID: string) => boolean
  toggleSessionPinned: (sessionID: string) => void
}) {
  const [sessionBucketsCollapsed, setSessionBucketsCollapsed] = createSignal<Record<string, boolean>>({ prior: true })
  const sessions = createMemo(() => projectSessions(props.project, props.snapshot, props.sessionOrderState))
  const attention = createMemo(() => projectAttentionItems(props.project, props.snapshot, props.sessionOrderState))
  const attentionSessionIDs = createMemo(() => new Set(attention().map((item) => item.sessionID)))
  const recentSessions = createMemo(() => sessions().filter((session) => !attentionSessionIDs().has(session.id) && (sessionOrderBucket(props.snapshot, session) !== "inactive" || isRecentSessionUpdate(session.time.updated))))
  const priorSessions = createMemo(() => sessions().filter((session) => !attentionSessionIDs().has(session.id) && sessionOrderBucket(props.snapshot, session) === "inactive" && !isRecentSessionUpdate(session.time.updated)))
  const swarms = createMemo(() => projectSwarms(props.project, props.snapshot))
  const views = createMemo(() => projectViews(props.project, props.snapshot))
  const primaryFolder = createMemo(() => props.project.folders[0]?.path)
  const toggleSessionBucket = (bucket: string) => setSessionBucketsCollapsed((value) => ({ ...value, [bucket]: !value[bucket] }))

  return (
    <div class="page project-command-page">
      <header class="project-home-header">
        <div>
          <Button size="sm" variant="ghost" icon="chevronLeft" onClick={props.back}>Projects</Button>
          <p class="eyebrow">Project home</p>
          <h1>{projectLabel(props.project)}</h1>
          <div class="project-home-folder-strip">
            <For each={props.project.folders} fallback={<span>No folders selected</span>}>
              {(folder) => <span title={folder.path}>{compactPath(folder.path)}</span>}
            </For>
            <button type="button" onClick={() => props.editProject(props.project.id, projectLabel(props.project), props.project.folders.map((folder) => folder.path))}>Edit project</button>
          </div>
        </div>
        <div class="project-home-actions">
          <Button variant="primary" icon="session" onClick={() => props.createSession(props.project.id, primaryFolder())}>New session</Button>
          <Button icon="swarm" onClick={() => props.createSwarm(props.project.id)}>Swarm</Button>
        </div>
      </header>

      <section class="project-home-layout project-home-layout-single">
        <div class="project-home-main">
          <ProjectHomePanel title="Attention" count={attention().length} empty="No sessions need your attention.">
            <For each={attention()}>
              {(item) => (
                <button class={`project-home-row ${projectAttentionRowClass(item)}`} onClick={() => props.openSession(item.sessionID)}>
                  <strong>{item.title}</strong>
                  <span>{item.detail}</span>
                </button>
              )}
            </For>
          </ProjectHomePanel>

          <div class="dashboard-session-groups">
            <SessionCardBucket title="Recent Sessions" count={recentSessions().length} empty="No recent sessions." collapsed={!!sessionBucketsCollapsed().recent} onToggle={() => toggleSessionBucket("recent")}>
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

            <SessionCardBucket title="Prior Sessions" count={priorSessions().length} empty="No prior sessions." collapsed={!!sessionBucketsCollapsed().prior} onToggle={() => toggleSessionBucket("prior")}>
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
          </div>

          <div class="project-home-split">
            <ProjectHomePanel title="Views" count={views().length} empty="No views include this project.">
              <For each={views().slice(0, 8)}>
                {(view) => (
                  <button class="project-home-row" onClick={() => props.openView(view.id)}>
                    <strong>{title(view.title)}</strong>
                    <span>{projectViewSessionCount(view)} sessions - {formatRelative(view.timeUpdated)}</span>
                  </button>
                )}
              </For>
            </ProjectHomePanel>

            <ProjectHomePanel title="Swarms" count={swarms().length} empty="No swarms for this project.">
              <For each={swarms().slice(0, 8)}>
                {(swarm) => (
                  <button class="project-home-row" onClick={() => props.openSwarm(swarm.id)}>
                    <strong>{title(swarm.title)}</strong>
                    <span>{swarm.roles.length} roles - {swarm.runs.length} runs</span>
                  </button>
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


function projectAttentionRowClass(item: ReturnType<typeof projectAttentionItems>[number]) {
  if (item.detail === sessionStatusLabel("ready_for_review")) return "ready-for-review"
  if (item.detail === sessionStatusLabel("input_needed")) return "input-needed"
  if (item.tone === "danger") return "failed"
  if (item.tone === "info") return "in-progress"
  return "input-needed"
}
