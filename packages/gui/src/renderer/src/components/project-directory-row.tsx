import { For, Show } from "solid-js"
import { Portal } from "solid-js/web"
import { compactPath, formatRelative, title } from "../lib/format"
import { projectLabel, type ProjectSummary } from "../lib/project-summary"
import type { PointerReorderPreview } from "../lib/pointer-reorder"
import { sessionStatusLabel } from "../lib/session-status"
import { AgentGlyph, Button, IconButton, StatusBadge } from "./ui"
import { CardActionMenu } from "./card-action-menu"

export type ProjectRowActions = {
  openProject: (projectID: string) => void
  createSession: (projectID?: string, directory?: string) => void
  editProject: (projectID: string, currentName: string, folders: string[]) => void
  deleteProject: (projectID: string, name: string) => void
  moveProject: (projectID: string, offset: number) => void
}

export function ProjectDirectoryRow(props: {
  summary: ProjectSummary
  actions: ProjectRowActions
  index: number
  total: number
  reorderable: boolean
  moving?: "up" | "down"
  dragging: boolean
  dropping?: "before" | "after"
  startPointerDrag: (event: PointerEvent & { currentTarget: HTMLElement }) => void
}) {
  const project = () => props.summary.project
  const name = () => projectLabel(project())
  const folders = () => project().folders.map((folder) => folder.path)
  const menuActions = () => [
    { label: "New session", icon: "session" as const, onSelect: () => props.actions.createSession(project().id, folders()[0]) },
    ...(props.reorderable
      ? [
          { label: "Move up", icon: "arrowUp" as const, disabled: props.index <= 0, onSelect: () => props.actions.moveProject(project().id, -1) },
          { label: "Move down", icon: "arrowDown" as const, disabled: props.index >= props.total - 1, onSelect: () => props.actions.moveProject(project().id, 1) },
        ]
      : []),
    { label: "Edit project", icon: "pencil" as const, onSelect: () => props.actions.editProject(project().id, name(), folders()) },
    { label: "Delete project", icon: "trash" as const, danger: true, onSelect: () => props.actions.deleteProject(project().id, name()) },
  ].filter((action) => !action.disabled)

  return (
    <article
      class="project-directory-row"
      classList={{
        [`status-${props.summary.status.replaceAll("_", "-")}`]: true,
        "moving-up": props.moving === "up",
        "moving-down": props.moving === "down",
        reorderable: props.reorderable,
        dragging: props.dragging,
        dropping: props.dropping !== undefined,
        "drop-after": props.dropping === "after",
      }}
      data-project-row-id={project().id}
      data-project-row-layout-id={project().id}
      onPointerDown={props.reorderable ? props.startPointerDrag : undefined}
    >
      <Button appearance="ghost" class="project-directory-open" onClick={() => props.actions.openProject(project().id)}>
        <AgentGlyph name={name()} class="project-directory-glyph" />
        <span class="project-directory-identity">
          <span class="project-directory-name">
            <strong>{name()}</strong>
            <Show when={props.summary.attention.length > 0}>
              <StatusBadge status="input_needed" tone={attentionTone(props.summary)} dot={false}>
                {attentionLabel(props.summary)}
              </StatusBadge>
            </Show>
          </span>
          <small title={folders().join(", ")}>{folderPreview(project())}</small>
        </span>
        <ProjectDirectoryMeta summary={props.summary} />
      </Button>
      <div class="project-directory-actions">
        <IconButton icon="session" label={`New session in ${name()}`} onClick={() => props.actions.createSession(project().id, folders()[0])} />
        <CardActionMenu label={name()} actions={menuActions()} />
      </div>
      <Show when={props.summary.status === "in_progress"}>
        <span class="mini-spinner" aria-label={sessionStatusLabel(props.summary.status)} />
      </Show>
      <Show when={props.summary.status === "ready_for_review"}>
        <span class="status-glyph" aria-label={sessionStatusLabel(props.summary.status)} />
      </Show>
    </article>
  )
}

export function ProjectDirectoryMeta(props: { summary: ProjectSummary }) {
  return (
    <span class="project-directory-meta">
      <span>{props.summary.sessionCount} {props.summary.sessionCount === 1 ? "session" : "sessions"}</span>
      <Show when={props.summary.terminalSessionCount > 0}>
        <span class="project-directory-meta-terminal">{props.summary.terminalSessionCount} Claude Code</span>
      </Show>
      <span>{activityLabel(props.summary.lastActivity)}</span>
    </span>
  )
}

export function ProjectDragPreview(props: { preview?: PointerReorderPreview; summary?: ProjectSummary }) {
  return (
    <Show when={props.preview && props.summary}>
      <Portal>
        <div
          class="project-directory-drag-preview"
          style={{
            left: `${props.preview?.x ?? 0}px`,
            top: `${props.preview?.y ?? 0}px`,
            width: `${props.preview?.width ?? 320}px`,
          }}
        >
          <Show when={props.summary}>
            {(summary) => (
              <>
                <AgentGlyph name={projectLabel(summary().project)} class="project-directory-glyph" />
                <span class="project-directory-identity">
                  <strong>{projectLabel(summary().project)}</strong>
                  <small>{folderPreview(summary().project)}</small>
                </span>
                <ProjectDirectoryMeta summary={summary()} />
              </>
            )}
          </Show>
        </div>
      </Portal>
    </Show>
  )
}

export function ProjectFolderStrip(props: { folders: string[]; empty: string }) {
  return (
    <div class="project-home-folder-strip">
      <For each={props.folders} fallback={<span>{props.empty}</span>}>
        {(folder) => <span title={folder}>{compactPath(folder)}</span>}
      </For>
    </div>
  )
}

function folderPreview(project: ProjectSummary["project"]) {
  return project.folders.map((folder) => compactPath(folder.path)).join(", ") || "No folders"
}

function attentionTone(summary: ProjectSummary) {
  return summary.attention.some((item) => item.tone === "danger") ? "danger" as const : "warning" as const
}

function attentionLabel(summary: ProjectSummary) {
  const failed = summary.attention.filter((item) => item.tone === "danger").length
  if (failed > 0) return `${failed} failed`
  return `${summary.attention.length} needs you`
}

function activityLabel(value: number) {
  return value > 0 ? formatRelative(value) : "never opened"
}
