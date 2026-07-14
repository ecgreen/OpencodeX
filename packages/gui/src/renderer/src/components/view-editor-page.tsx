import type { OpencodeXView, Session } from "@opencode-ai/sdk/v2/client"
import type { JSX } from "solid-js"
import { For, Show, createMemo, createSignal } from "solid-js"
import { compactPath, formatRelative, title } from "../lib/format"
import type { GuiSnapshot } from "../lib/store"
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
import { Icon } from "./icon"
import { Button, IconButton, TextInput } from "./ui"

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
  const [sessionQuery, setSessionQuery] = createSignal("")
  const selectedIDs = createMemo(() => new Set(selectedViewSessionIDs(selection())))
  const pending = createMemo(() => selectedPendingViewSessions(selection()))
  const atPaneLimit = createMemo(() => selection().length >= 8)
  const editing = createMemo(() => props.view !== undefined)
  const [collapsedSessionGroups, setCollapsedSessionGroups] = createSignal<Record<string, boolean>>({})
  const groupedSessions = createMemo(() => groupViewSessionsByProject({ sessions: props.sessions, projects: props.projects }))
  const filteredGroups = createMemo(() => filterSessionGroups(groupedSessions(), sessionQuery()))
  const hasAvailableSessions = createMemo(() => filteredGroups().projects.length > 0 || filteredGroups().unprojected.length > 0)
  const selectedPanes = createMemo(() => selection().map((item) => ({
    item,
    session: item.kind === "existing" ? props.sessions.find((session) => session.id === item.sessionID) : undefined,
  })))

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

  function removeExisting(sessionID: string) {
    setSelection((current) => current.filter((item) => item.kind !== "existing" || item.sessionID !== sessionID))
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
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form class="page view-editor-page" onSubmit={save}>
      <header class="view-editor-header">
        <div>
          <p class="eyebrow">{editing() ? "Edit view" : "Create view"}</p>
          <h1>{editing() ? props.view?.title ?? "Edit view" : "Create view"}</h1>
        </div>
        <div class="row-actions">
          <Button icon="x" onClick={props.cancel}>Cancel</Button>
        </div>
      </header>
      <div class="view-editor-layout">
        <aside class="view-builder-panel">
          <label class="full-width-field">
            <span>Title</span>
            <TextInput value={viewName()} onInput={(event) => setViewName(event.currentTarget.value)} placeholder="Generated from selected sessions" />
          </label>
          <section class="selected-pane-list">
            <header>
              <strong>Selected panes</strong>
              <span>{selection().length}/8</span>
            </header>
            <For each={selectedPanes()} fallback={<div class="empty">Select sessions from the list.</div>}>
              {(pane, index) => (
                <article class="selected-pane-row">
                  <span>{index() + 1}</span>
                  <div>
                    <strong>{pane.item.kind === "existing" ? title(pane.session?.title) : "New session"}</strong>
                    <small>{pane.item.kind === "existing" ? compactPath(pane.session?.directory) : pane.item.slot.projectLabel ?? "No project"}</small>
                  </div>
                  <IconButton
                    variant="danger"
                    icon="trash"
                    label="Remove pane"
                    onClick={() => pane.item.kind === "existing" ? removeExisting(pane.item.sessionID) : removePending(pane.item.slot.id)}
                  />
                </article>
              )}
            </For>
          </section>
          <section class="pending-pane-actions">
            <header><strong>{atPaneLimit() ? "Eight-pane limit reached" : "Add a new session pane"}</strong></header>
            <div class="row-actions">
              <Button size="sm" icon="plus" disabled={atPaneLimit()} onClick={() => addPending()}><span class="pending-pane-button-label">No project</span></Button>
              <For each={props.projects.slice(0, 3)}>
                {(project) => <Button size="sm" icon="plus" disabled={atPaneLimit()} onClick={() => addPending(project.id)}><span class="pending-pane-button-label">{title(project.name ?? project.project.name)}</span></Button>}
              </For>
            </div>
          </section>
          <section class="view-editor-submit-panel">
            <Show when={error()}>
              <div class="notice error">{error()}</div>
            </Show>
            <Button type="submit" variant="primary" icon="check" disabled={saving()}>
              {saving() ? "Saving..." : editing() ? "Save view" : "Create view"}
            </Button>
          </section>
        </aside>
        <section class="view-session-picker">
          <header>
            <div>
              <strong>Available sessions</strong>
              <span>{selectedIDs().size} selected</span>
            </div>
            <TextInput value={sessionQuery()} onInput={(event) => setSessionQuery(event.currentTarget.value)} placeholder="Search sessions" />
          </header>
          <Show when={hasAvailableSessions()} fallback={<div class="empty">No sessions available.</div>}>
            <div class="view-session-groups">
              <For each={filteredGroups().projects}>
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
                      <ViewSessionGrid sessions={group.sessions} selectedIDs={selectedIDs()} limitReached={atPaneLimit()} toggleSession={toggleSession} />
                    </ViewSessionGroup>
                  )
                }}
              </For>
              <Show when={filteredGroups().unprojected.length > 0}>
                <ViewSessionGroup
                  id="unprojected"
                  title="No Project"
                  count={filteredGroups().unprojected.length}
                  collapsed={collapsedSessionGroups().unprojected}
                  toggle={toggleSessionGroup}
                >
                  <ViewSessionGrid sessions={filteredGroups().unprojected} selectedIDs={selectedIDs()} limitReached={atPaneLimit()} toggleSession={toggleSession} />
                </ViewSessionGroup>
              </Show>
            </div>
          </Show>
        </section>
      </div>
    </form>
  )
}

function filterSessionGroups(grouped: ReturnType<typeof groupViewSessionsByProject>, query: string) {
  const value = query.trim().toLowerCase()
  if (!value) return grouped
  return {
    projects: grouped.projects
      .map((group) => ({ ...group, sessions: group.sessions.filter((session) => sessionMatchesQuery(session, value)) }))
      .filter((group) => group.sessions.length > 0),
    unprojected: grouped.unprojected.filter((session) => sessionMatchesQuery(session, value)),
  }
}

function sessionMatchesQuery(session: Session, query: string) {
  return [
    session.title,
    session.directory,
    session.id,
  ].some((item) => (item ?? "").toLowerCase().includes(query))
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
      <div class="view-session-group-content" classList={{ collapsed: !!props.collapsed }}>
        <div>{props.children}</div>
      </div>
    </section>
  )
}

function ViewSessionGrid(props: {
  sessions: Session[]
  selectedIDs: Set<string>
  limitReached: boolean
  toggleSession: (sessionID: string) => void
}) {
  return (
    <div class="view-session-grid">
      <For each={props.sessions}>
        {(session) => {
          const selected = () => props.selectedIDs.has(session.id)
          return (
            <label class="view-session-card view-session-row">
              <input type="checkbox" checked={selected()} disabled={props.limitReached && !selected()} onChange={() => props.toggleSession(session.id)} />
              <span class="view-session-card-copy">
                <strong>{title(session.title)}</strong>
                <small>{compactPath(session.directory)} - {formatRelative(session.time.updated)}</small>
              </span>
              <Show when={selected()}>
                <small class="view-session-selected">selected</small>
              </Show>
            </label>
          )
        }}
      </For>
    </div>
  )
}
