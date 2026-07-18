import { Button } from "./ui"
import type { Session } from "@opencode-ai/sdk/v2/client"
import { isRecentClientSessionUpdate } from "@opencode-ai/sdk/v2/session-order"
import type { JSX } from "solid-js"
import { Show, createMemo } from "solid-js"
import { formatRelative, title } from "../lib/format"
import { deriveSessionStatus, sessionStatusLabel } from "../lib/session-status"
import { type GuiSnapshot } from "../lib/store"
import { CardActionMenu } from "./card-action-menu"
import { CardContextMenu } from "./card-context-menu"
import { Empty } from "./dashboard-primitives"
import { Icon } from "./icon"

export function SessionCardBucket(props: { title: string; count: number; empty: string; collapsed: boolean; onToggle: () => void; children: JSX.Element }) {
  return (
    <section class="dashboard-session-bucket">
      <header>
        <Button appearance="ghost" class="dashboard-bucket-toggle" aria-label={`${props.collapsed ? "Expand" : "Collapse"} ${props.title}`} aria-expanded={!props.collapsed} onClick={props.onToggle}>
          <Icon name={props.collapsed ? "chevronRight" : "chevronDown"} />
          <strong>{props.title}</strong>
        </Button>
        <small>{props.count}</small>
      </header>
      <div class="dashboard-bucket-content" classList={{ collapsed: props.collapsed }}>
        <div class="dashboard-card-grid compact">
          <Show when={props.count > 0} fallback={<Empty text={props.empty} />}>
            {props.children}
          </Show>
        </div>
      </div>
    </section>
  )
}

export function SessionStatusCard(props: {
  session: Session
  snapshot?: GuiSnapshot
  openSession: (sessionID: string) => void
  pinned?: boolean
  togglePinned?: () => void
  renameSession?: () => void
  deleteSession?: () => void
  compact?: boolean
  meta?: string
}) {
  const status = createMemo(() => deriveSessionStatus(props.snapshot, props.session))
  const actions = () => [
    ...(props.togglePinned
      ? [{ label: props.pinned ? "Unpin" : "Pin", icon: "pin", onSelect: props.togglePinned }]
      : []),
    ...(props.renameSession ? [{ label: "Edit", icon: "pencil", onSelect: props.renameSession }] : []),
    ...(props.deleteSession ? [{ label: "Delete", icon: "trash", danger: true, onSelect: props.deleteSession }] : []),
  ]
  return (
    <CardContextMenu actions={actions()}>
      {(openMenu) => (
        <article
          class="dashboard-item-card dashboard-status-card interactive"
          classList={{ compact: props.compact === true, [`status-${status().replaceAll("_", "-")}`]: true }}
          onContextMenu={openMenu}
        >
          <Button appearance="ghost" class="dashboard-card-open" onClick={() => props.openSession(props.session.id)}>
            <div>
              <strong>{title(props.session.title)}</strong>
            </div>
            <footer>
              <span class="card-status-label">{sessionStatusLabel(status())}</span>
              <small>{props.meta ?? sessionCardMeta(props.session, props.snapshot)}</small>
            </footer>
          </Button>
          <Show when={actions().length > 0}>
            <CardActionMenu label={title(props.session.title)} actions={actions()} />
          </Show>
          <Show when={status() === "in_progress"}><span class="mini-spinner" aria-label="running" /></Show>
          <Show when={status() === "input_needed" || status() === "ready_for_review"}><span class="status-glyph" aria-label={sessionStatusLabel(status())} /></Show>
        </article>
      )}
    </CardContextMenu>
  )
}

export function sessionCardMeta(session: Session, snapshot?: GuiSnapshot) {
  return [formatRelative(session.time.updated), sessionProjectName(session, snapshot)].filter(Boolean).join(" - ")
}

export function isRecentSessionUpdate(timeUpdated: number, now = Date.now()) {
  return isRecentClientSessionUpdate(timeUpdated, now)
}

export function isAttentionSession(snapshot: GuiSnapshot | undefined, session: Session) {
  const status = deriveSessionStatus(snapshot, session)
  return status === "input_needed" || status === "ready_for_review"
}

function sessionProjectName(session: Session, snapshot?: GuiSnapshot) {
  const project = (snapshot?.projects ?? []).find((item) => item.sessions.some((projectSession) => projectSession.id === session.id))
  if (!project) return undefined
  return title(project.name ?? project.project.name)
}
