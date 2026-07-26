import { OpencodeXLogo } from "./chrome"
import { DashboardSection } from "./dashboard-primitives"

export function AppLoadingSkeleton() {
  return (
    <div class="page dashboard-page app-loading-skeleton" aria-label="Loading OpencodeX workspace" aria-busy="true">
      <OpencodeXLogo />
      <section class="dashboard-sections app-loading-sections">
        <SessionsPanel />
        <CardPanel title="Views" kind="views" />
        <CardPanel title="Swarms" kind="swarms" />
        <CardPanel title="Projects" kind="projects" />
      </section>
    </div>
  )
}

function SessionsPanel() {
  return (
    <DashboardSection title="Active sessions" count={0} action="New" actionLabel="New session" onAction={() => undefined}>
      <div class="dashboard-active-sessions app-loading-panel" aria-hidden="true">
        {[false, true, false].map((short) => <SessionLinkPlaceholder short={short} />)}
      </div>
    </DashboardSection>
  )
}

function CardPanel(props: { title: string; kind: "projects" | "swarms" | "views" }) {
  return (
    <DashboardSection title={props.title} count={0} action="New" actionLabel={`New ${props.kind === "projects" ? "project" : props.kind === "swarms" ? "swarm" : "view"}`} onAction={() => undefined}>
      <div class="dashboard-card-grid app-loading-panel" aria-hidden="true">
        {[0, 1, 2, 3].map((item) =>
          props.kind === "projects" ? (
            <ProjectCard short={item === 2} />
          ) : props.kind === "views" ? (
            <StatusCard short={item === 1 || item === 3} />
          ) : (
            <PlainCard short={item === 1 || item === 3} />
          ),
        )}
      </div>
    </DashboardSection>
  )
}

function SessionLinkPlaceholder(props: { short?: boolean }) {
  return (
    <div class="session-link-shell app-loading-session-link">
      <div class="session-link status-dormant app-loading-card">
        <span class="app-loading-line app-loading-title" data-short={props.short ? "true" : undefined} />
        <small><span class="app-loading-line app-loading-meta" /></small>
      </div>
    </div>
  )
}

function ProjectCard(props: { short?: boolean }) {
  return (
    <article class="dashboard-item-card dashboard-summary-card dashboard-project-card app-loading-card">
      <div class="dashboard-card-copy">
        <strong class="app-loading-line app-loading-title" data-short={props.short ? "true" : undefined} />
        <small><span class="app-loading-line app-loading-meta" /></small>
      </div>
    </article>
  )
}

function PlainCard(props: { short?: boolean }) {
  return (
    <article class="dashboard-item-card dashboard-summary-card dashboard-swarm-card app-loading-card">
      <div class="dashboard-card-copy">
        <strong class="app-loading-line app-loading-title" data-short={props.short ? "true" : undefined} />
        <small><span class="app-loading-line app-loading-meta" /></small>
      </div>
    </article>
  )
}

function StatusCard(props: { short?: boolean }) {
  return (
    <article class="dashboard-item-card dashboard-summary-card dashboard-view-card interactive status-dormant app-loading-card">
      <div class="dashboard-card-copy">
        <strong class="app-loading-line app-loading-title" data-short={props.short ? "true" : undefined} />
        <small><span class="app-loading-line app-loading-meta" /></small>
      </div>
    </article>
  )
}
