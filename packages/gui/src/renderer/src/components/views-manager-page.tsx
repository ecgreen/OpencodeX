import type { Accessor, JSX } from "solid-js"
import type { OpencodeXView, Session } from "@opencode-ai/sdk/v2/client"
import { For, Show, createMemo, createSignal } from "solid-js"
import { compactPath, formatRelative, title } from "../lib/format"
import {
  addPendingViewSessions,
  groupViewSessionsByProject,
  initialViewSelection,
  metadataWithPendingSessions,
  selectedPendingViewSessions,
  selectedViewSessionIDs,
  viewTitle,
  type ViewSelection,
} from "../lib/view-actions"
import type { GuiSnapshot } from "../lib/store"
import { type ViewItem } from "../lib/view-items"
import { Icon } from "./icon"
import { ViewsPage } from "./views"

export function ViewsManagerPage(props: {
  view?: OpencodeXView
  views: OpencodeXView[]
  sessions: Session[]
  projects: GuiSnapshot["projects"]
  items: ViewItem[]
  renderItem: (item: Accessor<ViewItem>) => JSX.Element
  openView: (viewID: string) => void
  createView: () => void
  editView: (viewID: string) => void
  deleteView: (viewID: string, title: string) => void | Promise<void>
  moveView: (viewID: string, offset: number) => void | Promise<void>
}) {
  return (
    <div class="page views-manager-page">
      <Show
        when={props.view}
        fallback={
          <>
            <ManagerHeader
              eyebrow="Views"
              title="Multi-session views"
              description="Create, edit, reorder, and open focused panes across existing or pending sessions."
              actions={[{ label: "Create view", icon: "plus", primary: true, onClick: props.createView }]}
            />
            <ViewList views={props.views} openView={props.openView} createView={props.createView} editView={props.editView} deleteView={props.deleteView} moveView={props.moveView} />
          </>
        }
      >
        {(view) => (
          <>
            <ActiveViewHeader
              title={view().title}
              edit={() => props.editView(view().id)}
              delete={() => props.deleteView(view().id, view().title)}
            />
            <ViewsPage view={view()} items={props.items} renderItem={props.renderItem} />
          </>
        )}
      </Show>
    </div>
  )
}

export function ViewEditorPage(props: {
  view?: OpencodeXView
  sessions: Session[]
  projects: GuiSnapshot["projects"]
  save: (input: { viewID?: string; title: string; sessionIDs: string[]; metadata?: Record<string, unknown> }) => void | Promise<void>
  cancel: () => void
}) {
  const [viewName, setViewName] = createSignal(props.view?.title ?? "")
  const [selection, setSelection] = createSignal<ViewSelection[]>(initialViewSelection(props.view))
  const [error, setError] = createSignal("")
  const [saving, setSaving] = createSignal(false)
  const selectedIDs = createMemo(() => new Set(selectedViewSessionIDs(selection())))
  const pending = createMemo(() => selectedPendingViewSessions(selection()))
  const editing = createMemo(() => props.view !== undefined)
  const [collapsedSessionGroups, setCollapsedSessionGroups] = createSignal<Record<string, boolean>>({})
  const groupedSessions = createMemo(() => groupViewSessionsByProject({ sessions: props.sessions, projects: props.projects }))
  const hasAvailableSessions = createMemo(() => groupedSessions().projects.length > 0 || groupedSessions().unprojected.length > 0)

  function toggleSession(sessionID: string) {
    setError("")
    if (selectedIDs().has(sessionID)) {
      setSelection((current) => current.filter((item) => item.kind !== "existing" || item.sessionID !== sessionID))
      return
    }
    if (selection().length >= 8) {
      setError("A view can include at most eight panes.")
      return
    }
    setSelection((current) => [...current, { kind: "existing", sessionID }])
  }

  function addPending(projectID?: string) {
    setError("")
    if (selection().length >= 8) {
      setError("A view can include at most eight panes.")
      return
    }
    const project = props.projects.find((item) => item.id === projectID)
    setSelection((current) => addPendingViewSessions({
      selection: current,
      count: 1,
      projectID: project?.id,
      projectLabel: project ? title(project.name ?? project.project.name) : undefined,
      directory: project?.folders[0]?.path,
    }))
  }

  function removePending(slotID: string) {
    setSelection((current) => current.filter((item) => item.kind !== "pending" || item.slot.id !== slotID))
  }

  function toggleSessionGroup(groupID: string) {
    setCollapsedSessionGroups((current) => ({ ...current, [groupID]: !current[groupID] }))
  }

  async function save(event: SubmitEvent) {
    event.preventDefault()
    setError("")
    if (selection().length === 0) {
      setError("Select at least one session or pending pane.")
      return
    }
    setSaving(true)
    try {
      await props.save({
        viewID: props.view?.id,
        title: viewTitle({ title: viewName(), selection: selection(), sessions: props.sessions }),
        sessionIDs: selectedViewSessionIDs(selection()),
        metadata: metadataWithPendingSessions(props.view?.metadata, pending()),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form class="page view-editor-page" onSubmit={save}>
      <ManagerHeader
        eyebrow={editing() ? "Edit view" : "Create view"}
        title={editing() ? props.view?.title ?? "Edit view" : "Create view"}
        description="Choose up to eight existing sessions or reserve pending panes that create sessions when prompted."
        actions={[{ label: "Cancel", icon: "x", onClick: props.cancel }]}
      />
      <section class="manager-section view-editor-details">
        <header><strong>Details</strong></header>
        <label class="full-width-field">
          <span>Title</span>
          <input value={viewName()} onInput={(event) => setViewName(event.currentTarget.value)} placeholder="Optional; generated from selected sessions" />
        </label>
      </section>
      <section class="manager-section view-editor-new-sessions">
        <header>
          <div>
            <strong>New Sessions</strong>
            <span>{pending().length}</span>
          </div>
          <div class="row-actions">
            <button type="button" class="secondary" onClick={() => addPending()}><Icon name="plus" /> No project</button>
            <For each={props.projects.slice(0, 3)}>
              {(project) => <button type="button" class="secondary" onClick={() => addPending(project.id)}><Icon name="plus" /> {title(project.name ?? project.project.name)}</button>}
            </For>
          </div>
        </header>
        <div class="dashboard-card-grid compact">
          <For each={pending()} fallback={<div class="empty">No pending panes.</div>}>
            {(slot) => (
              <article class="dashboard-item-card">
                <div>
                  <strong>New session</strong>
                  <span>{slot.projectLabel ?? "No project"}</span>
                </div>
                <footer>
                  <small>{compactPath(slot.directory)}</small>
                  <button type="button" class="danger" onClick={() => removePending(slot.id)}><Icon name="trash" /> Remove</button>
                </footer>
              </article>
            )}
          </For>
        </div>
      </section>
      <section class="manager-section view-editor-session-section">
        <header>
          <strong>Sessions</strong>
          <span>{selectedIDs().size} selected</span>
        </header>
        <Show when={hasAvailableSessions()} fallback={<div class="empty">No sessions available.</div>}>
          <div class="view-session-groups">
            <For each={groupedSessions().projects}>
              {(group) => {
                const groupID = () => `project:${group.project.id}`
                return (
                  <ViewSessionGroup
                    id={groupID()}
                    title={title(group.project.name ?? group.project.project.name)}
                    count={group.sessions.length}
                    collapsed={collapsedSessionGroups()[groupID()]}
                    toggle={toggleSessionGroup}
                  >
                    <ViewSessionGrid sessions={group.sessions} selectedIDs={selectedIDs()} toggleSession={toggleSession} />
                  </ViewSessionGroup>
                )
              }}
            </For>
            <Show when={groupedSessions().unprojected.length > 0}>
              <ViewSessionGroup
                id="unprojected"
                title="No Project"
                count={groupedSessions().unprojected.length}
                collapsed={collapsedSessionGroups().unprojected}
                toggle={toggleSessionGroup}
              >
                <ViewSessionGrid sessions={groupedSessions().unprojected} selectedIDs={selectedIDs()} toggleSession={toggleSession} />
              </ViewSessionGroup>
            </Show>
          </div>
        </Show>
      </section>
      <Show when={error()}>
        <div class="notice error">{error()}</div>
      </Show>
      <div class="form-actions">
        <button type="button" class="secondary" onClick={props.cancel}><Icon name="x" /> Cancel</button>
        <button type="submit" class="primary" disabled={saving()}><Icon name="check" /> {saving() ? "Saving..." : editing() ? "Save view" : "Create view"}</button>
      </div>
    </form>
  )
}

function ViewSessionGroup(props: {
  id: string
  title: string
  count: number
  collapsed?: boolean
  toggle: (id: string) => void
  children: JSX.Element
}) {
  return (
    <section class="view-session-group">
      <button type="button" class="view-session-group-header" aria-expanded={!props.collapsed} onClick={() => props.toggle(props.id)}>
        <span>
          <Icon name={props.collapsed ? "chevronRight" : "chevronDown"} />
          <strong>{props.title}</strong>
        </span>
        <small>{props.count} {props.count === 1 ? "session" : "sessions"}</small>
      </button>
      <Show when={!props.collapsed}>
        {props.children}
      </Show>
    </section>
  )
}

function ViewSessionGrid(props: {
  sessions: Session[]
  selectedIDs: Set<string>
  toggleSession: (sessionID: string) => void
}) {
  return (
    <div class="view-session-grid">
      <For each={props.sessions}>
        {(session) => (
          <label class="view-session-card session-link">
            <input type="checkbox" checked={props.selectedIDs.has(session.id)} onChange={() => props.toggleSession(session.id)} />
            <span class="view-session-card-copy">
              <strong>{title(session.title)}</strong>
              <small>{compactPath(session.directory)} - {formatRelative(session.time.updated)}</small>
            </span>
          </label>
        )}
      </For>
    </div>
  )
}

function ViewList(props: {
  views: OpencodeXView[]
  openView: (viewID: string) => void
  createView: () => void
  editView: (viewID: string) => void
  deleteView: (viewID: string, title: string) => void | Promise<void>
  moveView: (viewID: string, offset: number) => void | Promise<void>
}) {
  return (
    <section class="manager-section">
      <header>
        <strong>Views</strong>
        <span>{props.views.length}</span>
      </header>
      <div class="dashboard-card-grid">
        <For each={props.views} fallback={<button class="dashboard-item-card empty-create interactive" onClick={props.createView}><strong>+ Create view</strong><span>Build a focused multi-session view.</span><small>create</small></button>}>
          {(view, index) => (
            <article class="dashboard-item-card view-list-card">
              <button class="dashboard-card-open" onClick={() => props.openView(view.id)}>
                <div>
                  <strong>{title(view.title)}</strong>
                  <span>{viewSessionCount(view)} panes - {formatRelative(view.timeUpdated)}</span>
                </div>
              </button>
              <div class="view-card-actions">
                <button type="button" title="Move view up" aria-label="Move view up" disabled={index() === 0} onClick={() => props.moveView(view.id, -1)}>
                  <Icon name="chevronDown" />
                </button>
                <button type="button" title="Move view down" aria-label="Move view down" disabled={index() === props.views.length - 1} onClick={() => props.moveView(view.id, 1)}>
                  <Icon name="chevronDown" />
                </button>
                <button type="button" title="Edit view" aria-label="Edit view" onClick={() => props.editView(view.id)}>
                  <Icon name="pencil" />
                </button>
                <button type="button" class="danger" title="Delete view" aria-label="Delete view" onClick={() => props.deleteView(view.id, view.title)}>
                  <Icon name="trash" />
                </button>
              </div>
            </article>
          )}
        </For>
      </div>
    </section>
  )
}

function viewSessionCount(view: OpencodeXView) {
  const opencodex = view.metadata?.opencodex
  const pending = typeof opencodex === "object" && opencodex !== null && "pendingSessions" in opencodex && Array.isArray(opencodex.pendingSessions)
    ? opencodex.pendingSessions.length
    : 0
  return view.sessionIDs.length + pending
}

function ManagerHeader(props: {
  eyebrow: string
  title: string
  description: string
  actions: Array<{ label: string; icon: string; danger?: boolean; primary?: boolean; onClick: () => void | Promise<void> }>
}) {
  return (
    <header class="manager-page-header">
      <div>
        <p class="eyebrow">{props.eyebrow}</p>
        <h1>{props.title}</h1>
        <p>{props.description}</p>
      </div>
      <div class="row-actions">
        <For each={props.actions}>
          {(action) => <button type="button" class={action.danger ? "danger" : action.primary ? "primary manager-create-button" : "secondary"} onClick={action.onClick}><Icon name={action.icon} /> {action.label}</button>}
        </For>
      </div>
    </header>
  )
}

function ActiveViewHeader(props: {
  title: string
  edit: () => void | Promise<void>
  delete: () => void | Promise<void>
}) {
  return (
    <header class="active-view-header">
      <div>
        <h1>{props.title}</h1>
      </div>
      <div class="active-view-actions">
        <button type="button" title="Edit view" aria-label="Edit view" onClick={props.edit}>
          <Icon name="pencil" />
        </button>
        <button type="button" class="danger" title="Delete view" aria-label="Delete view" onClick={props.delete}>
          <Icon name="trash" />
        </button>
      </div>
    </header>
  )
}
