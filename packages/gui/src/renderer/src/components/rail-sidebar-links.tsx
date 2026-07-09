import type { OpencodeXView, Session } from "@opencode-ai/sdk/v2/client"
import { Show, createMemo } from "solid-js"
import { formatRelative, title } from "../lib/format"
import type { GuiSnapshot } from "../lib/store"
import { deriveSessionStatus, deriveViewStatus, sessionStatusLabel, type DerivedSessionStatus } from "../lib/session-status"
import { pendingViewSessions } from "../lib/view-items"
import { CardContextMenu } from "./card-context-menu"
import { PinButton } from "./pin-button"

export function SidebarSessionLink(props: {
  session: Session
  snapshot?: GuiSnapshot
  active: boolean
  nested?: boolean
  pinned?: boolean
  onClick: () => void
  togglePinned?: () => void
  renameSession?: () => void
  deleteSession?: () => void
}) {
  const status = createMemo(() => deriveSessionStatus(props.snapshot, props.session))
  const subtitle = createMemo(() => [props.session.model?.id?.slice((props.session.model?.id ?? "").lastIndexOf("/") + 1), formatRelative(props.session.time.updated)].filter(Boolean).join(" - "))
  return (
    <CardContextMenu actions={[
      ...(props.renameSession ? [{ label: "Edit", icon: "pencil", onSelect: props.renameSession }] : []),
      ...(props.deleteSession ? [{ label: "Delete", icon: "trash", danger: true, onSelect: props.deleteSession }] : []),
    ]}>
      {(openMenu) => (
        <div class="session-link-shell" classList={{ nested: props.nested }} onContextMenu={openMenu}>
          <button
            title={`${title(props.session.title)} - ${sessionStatusLabel(status())} - ${formatRelative(props.session.time.updated)}`}
            class={`session-link ${statusClass(status())}`}
            classList={{ active: props.active }}
            onClick={props.onClick}
          >
            <span>{title(props.session.title)}</span>
            <small>
              <span>{subtitle()}</span>
            </small>
            <Show when={status() === "in_progress"}><span class="mini-spinner" aria-label="running" /></Show>
            <Show when={status() === "input_needed" || status() === "ready_for_review"}><span class="status-glyph" aria-label={sessionStatusLabel(status())} /></Show>
          </button>
          <Show when={props.togglePinned}>
            {(togglePinned) => <PinButton pinned={props.pinned === true} label={title(props.session.title)} onClick={togglePinned()} />}
          </Show>
        </div>
      )}
    </CardContextMenu>
  )
}

export function SidebarViewLink(props: {
  view: OpencodeXView
  snapshot?: GuiSnapshot
  active: boolean
  pinned?: boolean
  onClick: () => void
  togglePinned?: () => void
  editView?: () => void
  deleteView?: () => void
}) {
  const status = createMemo(() => deriveViewStatus(props.view, props.snapshot))
  return (
    <CardContextMenu actions={[
      ...(props.editView ? [{ label: "Edit", icon: "pencil", onSelect: props.editView }] : []),
      ...(props.deleteView ? [{ label: "Delete", icon: "trash", danger: true, onSelect: props.deleteView }] : []),
    ]}>
      {(openMenu) => (
        <div class="session-link-shell" onContextMenu={openMenu}>
          <button
            title={`${title(props.view.title)} - ${sessionStatusLabel(status())} - ${viewSessionCount(props.view)} sessions`}
            class={`session-link ${statusClass(status())}`}
            classList={{ active: props.active }}
            onClick={props.onClick}
          >
            <span>{title(props.view.title)}</span>
            <small>
              <span>{viewSessionCount(props.view)} sessions</span>
            </small>
            <Show when={status() === "in_progress"}><span class="mini-spinner" aria-label="running" /></Show>
            <Show when={status() === "input_needed" || status() === "ready_for_review"}><span class="status-glyph" aria-label={sessionStatusLabel(status())} /></Show>
          </button>
          <Show when={props.togglePinned}>
            {(togglePinned) => <PinButton pinned={props.pinned === true} label={title(props.view.title)} onClick={togglePinned()} />}
          </Show>
        </div>
      )}
    </CardContextMenu>
  )
}

export function viewSessionCount(view: OpencodeXView) {
  return view.sessionIDs.length + pendingViewSessions(view).length
}

function statusClass(status: DerivedSessionStatus) {
  return `status-${status.replaceAll("_", "-")}`
}
