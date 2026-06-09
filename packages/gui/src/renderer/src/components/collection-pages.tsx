import type { Session } from "@opencode-ai/sdk/v2/client"
import { For, createMemo } from "solid-js"
import { compactPath, title } from "../lib/format"
import type { GuiSnapshot } from "../lib/store"
import { StatusPill } from "./status-pill"

export function SessionCollectionPage(props: {
  sessions: Session[]
  sessionStatus: GuiSnapshot["sessionStatus"]
  openSession: (sessionID: string) => void
}) {
  return (
    <div class="page placeholder-page list-page">
      <p class="eyebrow">Sessions</p>
      <h1>Session workspace</h1>
      <p>Open, monitor, and resume existing TUI-compatible sessions from the shared backend data model.</p>
      <For each={props.sessions} fallback={<Empty text="No sessions" />}>
        {(session) => (
          <button class="card-row interactive" onClick={() => props.openSession(session.id)}>
            <div>
              <strong>{title(session.title)}</strong>
              <span>{compactPath(session.directory)}</span>
            </div>
            <StatusPill status={props.sessionStatus[session.id]?.type ?? "idle"} />
          </button>
        )}
      </For>
    </div>
  )
}

export function ProjectCollectionPage(props: {
  projects: GuiSnapshot["projects"]
  sessionCount: (project: GuiSnapshot["projects"][number]) => number
  createSession: (projectID?: string, directory?: string) => void
  editProject: (projectID: string, currentName: string, folders: string[]) => void
}) {
  return (
    <div class="page placeholder-page list-page">
      <p class="eyebrow">Projects</p>
      <h1>Project groups</h1>
      <p>Project groups, folders, and nested sessions are loaded from the same OpencodeX backend used by the TUI.</p>
      <For each={props.projects} fallback={<Empty text="No projects" />}>
        {(project) => (
          <article class="card-row">
            <div>
              <strong>{title(project.name ?? project.project.name)}</strong>
              <span>{project.folders.map((folder) => compactPath(folder.path)).join(", ")}</span>
            </div>
            <div class="row-actions">
              <small>{props.sessionCount(project)} sessions</small>
              <button onClick={() => props.createSession(project.id, project.folders[0]?.path)}>Session</button>
              <button onClick={() => props.editProject(project.id, title(project.name ?? project.project.name), project.folders.map((folder) => folder.path))}>Edit</button>
            </div>
          </article>
        )}
      </For>
    </div>
  )
}

export function StatusPage(props: { snapshot?: GuiSnapshot }) {
  const activeProviders = createMemo(() => props.snapshot?.providers.filter((provider) => Object.values(provider.models).some((model) => model.status !== "deprecated")).length ?? 0)
  return (
    <div class="page placeholder-page list-page">
      <p class="eyebrow">Status</p>
      <h1>Runtime status</h1>
      <p>Provider, model, agent, session, and safety status surfaces are loaded through existing OpencodeX endpoints.</p>
      <section class="metric-grid">
        <Metric label="Providers" value={activeProviders()} />
        <Metric label="Models" value={props.snapshot?.providers.flatMap((provider) => Object.values(provider.models)).filter((model) => model.status !== "deprecated").length ?? 0} />
        <Metric label="Agents" value={props.snapshot?.agents.length ?? 0} />
        <Metric label="Active Sessions" value={Object.values(props.snapshot?.sessionStatus ?? {}).filter((status) => status.type !== "idle").length} />
        <Metric label="Input Needed" value={(props.snapshot?.permissions.length ?? 0) + (props.snapshot?.questions.length ?? 0)} />
      </section>
    </div>
  )
}

export function CollectionPage(props: { title: string; count: number; description: string }) {
  return (
    <div class="page placeholder-page">
      <p class="eyebrow">Parity area</p>
      <h1>{props.title}</h1>
      <p>{props.description}</p>
      <div class="metric-card large"><strong>{props.count}</strong><span>records available through existing backend APIs</span></div>
    </div>
  )
}

function Metric(props: { label: string; value: number }) {
  return <div class="metric-card"><span>{props.label}</span><strong>{props.value}</strong></div>
}

function Empty(props: { text: string }) {
  return <div class="empty">{props.text}</div>
}
