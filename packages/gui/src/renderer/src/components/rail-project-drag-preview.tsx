import type { Session } from "@opencode-ai/sdk/v2/client"
import { For, Show } from "solid-js"
import { Portal } from "solid-js/web"
import { title } from "../lib/format"
import type { GuiSnapshot } from "../lib/session-api"
import { Icon } from "./icon"

export type ProjectDragPreviewState = { id: string; x: number; y: number; width: number; height: number }

export function ProjectDragPreview(props: {
  preview?: ProjectDragPreviewState
  project?: GuiSnapshot["projects"][number]
  sessions: Session[]
  expanded: boolean
}) {
  return (
    <Show when={props.preview && props.project}>
      <Portal>
        <div
          class="project-drag-preview"
          style={{ left: `${props.preview?.x ?? 0}px`, top: `${props.preview?.y ?? 0}px`, width: `${props.preview?.width ?? 262}px` }}
        >
          <div class="project-drag-preview-heading">
            <span class="project-drag-preview-icon"><Icon name={props.expanded ? "folder-open" : "folder"} /></span>
            <strong>{title(props.project?.name ?? props.project?.project.name ?? "")}</strong>
          </div>
          <Show when={props.expanded && props.sessions.length > 0}>
            <div class="project-drag-preview-sessions">
              <For each={props.sessions}>
                {(session) => <span>{title(session.title)}</span>}
              </For>
            </div>
          </Show>
        </div>
      </Portal>
    </Show>
  )
}
