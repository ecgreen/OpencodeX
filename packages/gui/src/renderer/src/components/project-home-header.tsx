import { For, Show, createSignal } from "solid-js"
import { compactPath } from "../lib/format"
import { projectLabel, type ProjectSummary } from "../lib/project-summary"
import { sessionStatusLabel } from "../lib/session-status"
import { AgentGlyph, Button, IconButton, StatusBadge } from "./ui"
import { CardActionMenu } from "./card-action-menu"

/** How long a copied chip keeps saying so before it goes back to its path. */
const COPY_FEEDBACK_MS = 1400

export function ProjectHomeHeader(props: {
  summary: ProjectSummary
  back: () => void
  createSession: (projectID?: string, directory?: string) => void
  editProject: (projectID: string, currentName: string, folders: string[]) => void
  deleteProject: (projectID: string, name: string) => void
}) {
  const project = () => props.summary.project
  const name = () => projectLabel(project())
  const folders = () => project().folders.map((folder) => folder.path)
  const actions = () => [
    { label: "Edit project", icon: "pencil" as const, onSelect: () => props.editProject(project().id, name(), folders()) },
    { label: "Delete project", icon: "trash" as const, danger: true, onSelect: () => props.deleteProject(project().id, name()) },
  ]

  return (
    <header class="project-home-header">
      <div>
        <Button size="compact" appearance="ghost" icon="chevronLeft" onClick={props.back}>Projects</Button>
        <div class="project-home-identity">
          <AgentGlyph name={name()} size="prominent" />
          <div>
            <p class="eyebrow">Project</p>
            <h1>{name()}</h1>
          </div>
          <ProjectHomeStatus summary={props.summary} />
        </div>
        <div class="project-home-folder-strip">
          <For each={project().folders} fallback={<span class="empty-folder">No folders selected</span>}>
            {(folder) => (
              <ProjectFolderChip
                path={folder.path}
                createSession={() => props.createSession(project().id, folder.path)}
              />
            )}
          </For>
          <Button
            appearance="ghost"
            size="compact"
            icon="plus"
            class="project-home-folder-add"
            onClick={() => props.editProject(project().id, name(), folders())}
          >
            Add folder
          </Button>
        </div>
      </div>
      <div class="project-home-actions">
        <Button
          appearance="solid"
          tone="accent"
          icon="session"
          onClick={() => props.createSession(project().id, folders()[0])}
        >
          New session
        </Button>
        <CardActionMenu label={name()} actions={actions()} />
      </div>
    </header>
  )
}

function ProjectHomeStatus(props: { summary: ProjectSummary }) {
  const attention = () => props.summary.attention.length
  const failing = () => props.summary.attention.some((item) => item.tone === "danger")
  return (
    <Show
      when={attention() > 0}
      fallback={
        <StatusBadge status={props.summary.status}>
          {props.summary.status === "dormant" ? "idle" : sessionStatusLabel(props.summary.status)}
        </StatusBadge>
      }
    >
      <StatusBadge status="input_needed" tone={failing() ? "danger" : "warning"}>
        {failing() ? `${attention()} blocked` : `${attention()} needs you`}
      </StatusBadge>
    </Show>
  )
}

/**
 * A folder is a place you act on, not a label. The path stays the chip's
 * subject; copy and "start here" appear only while it is being used.
 */
function ProjectFolderChip(props: { path: string; createSession: () => void }) {
  const [copied, setCopied] = createSignal(false)
  const copy = async () => {
    await navigator.clipboard?.writeText(props.path)
    setCopied(true)
    window.setTimeout(() => setCopied(false), COPY_FEEDBACK_MS)
  }
  return (
    <span class="project-home-folder-chip" classList={{ copied: copied() }} title={props.path}>
      <span class="project-home-folder-path">{copied() ? "Copied" : compactPath(props.path)}</span>
      <span class="project-home-folder-actions">
        <IconButton size="compact" icon="copy" label={`Copy ${props.path}`} onClick={() => void copy()} />
        <IconButton size="compact" icon="session" label={`New session in ${props.path}`} onClick={props.createSession} />
      </span>
    </span>
  )
}
