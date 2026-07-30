import { For, Show, createMemo, createSignal } from "solid-js"
import { createPointerReorder } from "../lib/pointer-reorder"
import { moveRelative } from "../lib/reorder"
import {
  filterProjectSummaries,
  projectLabel,
  sortProjectSummaries,
  summarizeProjects,
  type ProjectDirectorySort,
  type ProjectOverviewFilter,
  type ProjectSummary,
} from "../lib/project-summary"
import type { SessionOrderState } from "../lib/app-session-lists"
import type { GuiSnapshot } from "../lib/session-api"
import { Button, EmptyState, SearchField, SegmentedControl, Skeleton } from "./ui"
import { ProjectDirectoryRow, ProjectDragPreview, type ProjectRowActions } from "./project-directory-row"
import { ProjectOverviewTiles } from "./project-overview-tiles"

export { projectLabel } from "../lib/project-summary"

const SORT_ITEMS = [
  { value: "custom" as const, label: "Custom" },
  { value: "activity" as const, label: "Activity" },
  { value: "attention" as const, label: "Attention" },
]

export function ProjectsOverview(props: {
  projects: GuiSnapshot["projects"]
  query: string
  setQuery: (value: string) => void
  snapshot?: GuiSnapshot
  loading?: boolean
  sessionOrderState?: SessionOrderState
  openProject: (projectID: string) => void
  createProject: () => void
  createSession: (projectID?: string, directory?: string) => void
  editProject: (projectID: string, currentName: string, folders: string[]) => void
  deleteProject: (projectID: string, name: string) => void
  moveProject: (projectID: string, offset: number) => void
  reorderProject: (sourceID: string, targetID: string, placement: "before" | "after") => void
}) {
  const [sort, setSort] = createSignal<ProjectDirectorySort>("custom")
  const [filter, setFilter] = createSignal<ProjectOverviewFilter>("all")
  const [announcement, setAnnouncement] = createSignal("")
  const summaries = createMemo(() => summarizeProjects({
    projects: props.projects,
    snapshot: props.snapshot,
    state: props.sessionOrderState,
  }))
  const matching = createMemo(() => filterProjectSummaries(summaries(), props.query, filter()))
  const ordered = createMemo(() => sortProjectSummaries(matching(), sort()))
  const activeSummaries = createMemo(() => ordered().filter((summary) => summary.group === "active"))
  const quietSummaries = createMemo(() => ordered().filter((summary) => summary.group === "quiet"))
  const reorderable = createMemo(() => sort() === "custom" && filter() === "all" && props.query.trim() === "")
  const rowActions: ProjectRowActions = {
    openProject: (projectID) => {
      if (reorder.suppressed(projectID)) return
      props.openProject(projectID)
    },
    createSession: props.createSession,
    editProject: props.editProject,
    deleteProject: props.deleteProject,
    moveProject: (projectID, offset) => {
      reorder.markMoved(projectID, offset < 0 ? "up" : "down")
      props.moveProject(projectID, offset)
      announceMove(projectID, indexOf(projectID) + offset)
    },
  }
  const reorder = createPointerReorder<ProjectSummary>({
    items: ordered,
    getID: (summary) => summary.project.id,
    rowAttribute: "data-project-row-id",
    layoutAttribute: "data-project-row-layout-id",
    ignoreSelector: ".project-directory-actions",
    onReorder: (sourceID, target) => {
      const ids = moveRelative(ordered().map((summary) => summary.project.id), sourceID, target.id, target.placement)
      props.reorderProject(sourceID, target.id, target.placement)
      announceMove(sourceID, ids.indexOf(sourceID))
    },
  })
  const indexOf = (projectID: string) => props.projects.findIndex((project) => project.id === projectID)

  return (
    <div class="page project-command-page">
      <header class="project-directory-header">
        <div>
          <h1>Projects</h1>
          <ProjectDirectoryHeadline summaries={summaries()} />
        </div>
        <div class="project-directory-header-actions">
          <Button appearance="solid" tone="accent" icon="plus" onClick={() => props.createSession()}>New session</Button>
          <Button appearance="outline" icon="plus" onClick={props.createProject}>Create project</Button>
        </div>
      </header>

      <ProjectOverviewTiles summaries={summaries()} filter={filter()} setFilter={setFilter} />

      <section class="project-directory-panel">
        <header>
          <div>
            <h2>All projects</h2>
            <span>{ordered().length === summaries().length ? `${summaries().length} shown` : `${ordered().length} of ${summaries().length}`}</span>
          </div>
          <div class="project-directory-controls">
            <SearchField
              aria-label="Search projects, folders, or sessions"
              placeholder="Search projects, folders, or sessions"
              value={props.query}
              onInput={(event) => props.setQuery(event.currentTarget.value)}
              clearable={props.query.length > 0}
              onClear={() => props.setQuery("")}
            />
            <SegmentedControl label="Sort projects" items={SORT_ITEMS} value={sort()} onChange={setSort} />
          </div>
        </header>
        <div class="project-directory-list" aria-busy={props.loading ? "true" : undefined}>
          <Show when={!props.loading} fallback={<ProjectDirectorySkeleton />}>
            <Show when={summaries().length > 0} fallback={<ProjectEmptyState empty createProject={props.createProject} clearFilters={clearFilters} />}>
              <Show when={ordered().length > 0} fallback={<ProjectEmptyState empty={false} createProject={props.createProject} clearFilters={clearFilters} />}>
                <ProjectRows
                  rows={reorder.rows()}
                  active={activeSummaries()}
                  quiet={quietSummaries()}
                  reorderable={reorderable()}
                />
              </Show>
            </Show>
          </Show>
          <ProjectDragPreview preview={reorder.preview()} summary={reorder.previewItem()} />
        </div>
      </section>
      <p class="ds-visually-hidden" role="status" aria-live="polite">{announcement()}</p>
    </div>
  )

  function clearFilters() {
    props.setQuery("")
    setFilter("all")
  }

  /**
   * Reordering is the one action here with no visible result for a reader who
   * is not watching the rows move, so the new position is spoken. The position
   * is the intended one, computed before the backend round-trip lands.
   */
  function announceMove(projectID: string, targetIndex: number) {
    const summary = summaries().find((item) => item.project.id === projectID)
    if (targetIndex < 0 || !summary) return
    setAnnouncement(`${projectLabel(summary.project)} moved to position ${targetIndex + 1} of ${props.projects.length}.`)
  }

  /**
   * One list, split by group only when there is something quiet to separate.
   * Rows come from the reorder machinery so a drag keeps its placeholder.
   */
  function ProjectRows(inner: {
    rows: ReturnType<typeof reorder.rows>
    active: ProjectSummary[]
    quiet: ProjectSummary[]
    reorderable: boolean
  }) {
    const quietIDs = createMemo(() => new Set(inner.quiet.map((summary) => summary.project.id)))
    /**
     * The divider claims everything below it is quiet, so it renders only when
     * that is true: the quiet rows form the tail of the list. A custom order
     * that interleaves the groups gets no divider rather than a lying one.
     */
    const dividerRowID = createMemo(() => {
      if (inner.active.length === 0 || inner.quiet.length === 0) return undefined
      const first = inner.rows.findIndex((row) => quietIDs().has(row.id))
      if (first === -1) return undefined
      return inner.rows.slice(first).every((row) => quietIDs().has(row.id)) ? inner.rows[first].id : undefined
    })
    return (
      <For each={inner.rows}>
        {(row) => (
          <>
            <Show when={dividerRowID() === row.id}>
              <p class="project-directory-divider">Quiet</p>
            </Show>
            <Show
              when={row.type === "item" ? row : undefined}
              fallback={
                <div
                  class="project-directory-drop-placeholder"
                  data-project-row-layout-id="placeholder"
                  style={{ height: `${row.type === "placeholder" ? row.height : 0}px` }}
                />
              }
            >
              {(item) => (
                <ProjectDirectoryRow
                  summary={item().item}
                  actions={rowActions}
                  index={indexOf(item().id)}
                  total={props.projects.length}
                  reorderable={inner.reorderable}
                  moving={reorder.moving(item().id)}
                  dragging={reorder.dragging(item().id)}
                  dropping={reorder.dropping(item().id)}
                  startPointerDrag={(event) => reorder.startDrag(event, item().id)}
                />
              )}
            </Show>
          </>
        )}
      </For>
    )
  }
}

function ProjectDirectoryHeadline(props: { summaries: ProjectSummary[] }) {
  const running = () => props.summaries.reduce((count, summary) => count + summary.runningSessionCount, 0)
  const attention = () => props.summaries.reduce((count, summary) => count + summary.attention.length, 0)
  return (
    <p class="project-directory-headline">
      <span>{props.summaries.length} {props.summaries.length === 1 ? "project" : "projects"}</span>
      <Show when={running() > 0}>
        <span class="project-directory-headline-running">{running()} running</span>
      </Show>
      <Show when={attention() > 0}>
        <span class="project-directory-headline-attention">{attention()} needs your input</span>
      </Show>
      <Show when={running() === 0 && attention() === 0}>
        <span>nothing needs you right now</span>
      </Show>
    </p>
  )
}

function ProjectDirectorySkeleton() {
  return (
    <div class="project-directory-skeleton">
      <For each={[0, 1, 2]}>{() => <Skeleton shape="block" />}</For>
    </div>
  )
}

function ProjectEmptyState(props: { empty: boolean; createProject: () => void; clearFilters: () => void }) {
  return (
    <Show
      when={props.empty}
      fallback={
        <EmptyState
          title="No projects match this search"
          description="Try a different name or folder path, or clear the filters."
          action={<Button appearance="outline" icon="x" onClick={props.clearFilters}>Clear filters</Button>}
        />
      }
    >
      <EmptyState
        title="Create your first project"
        description="Pick the folders you work in together. A project keeps their sessions, terminals, and views in one place."
        action={<Button appearance="solid" tone="accent" icon="plus" onClick={props.createProject}>Create project</Button>}
      />
    </Show>
  )
}
