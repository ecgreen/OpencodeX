import { Button } from "./ui"
import { OpencodeXLogo } from "./chrome"
import { DashboardSection } from "./dashboard-primitives"

export function AppLoadingSkeleton() {
  return (
    <div class="page dashboard-page app-loading-skeleton" aria-label="Loading OpencodeX workspace" aria-busy="true">
      <OpencodeXLogo />
      <section class="dashboard-sections app-loading-sections">
        <SessionsPanel />
        <CardPanel title="Projects" kind="projects" />
        <CardPanel title="Swarms" kind="swarms" />
        <CardPanel title="Views" kind="views" />
      </section>
    </div>
  )
}

function SessionsPanel() {
  return (
    <DashboardSection title="Sessions" count={0} action="New" onAction={() => undefined}>
      <div class="dashboard-session-groups app-loading-panel" aria-hidden="true">
        {["Needs Feedback", "Ready For Review", "In Progress", "Inactive Sessions"].map((title, index) => (
          <section class="dashboard-session-bucket">
            <header>
              <Button appearance="ghost" class="dashboard-bucket-toggle" aria-expanded={index !== 3} tabindex={-1}>
                <span class="app-loading-bucket-chevron" />
                <strong>{title}</strong>
              </Button>
              <small>0</small>
            </header>
            <div class="dashboard-bucket-content" classList={{ collapsed: index === 3 }}>
              <div class="dashboard-card-grid compact">
                <StatusCard short={index === 1} />
              </div>
            </div>
          </section>
        ))}
      </div>
    </DashboardSection>
  )
}

function CardPanel(props: { title: string; kind: "projects" | "swarms" | "views" }) {
  return (
    <DashboardSection title={props.title} count={0} action="New" onAction={() => undefined}>
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

function ProjectCard(props: { short?: boolean }) {
  return (
    <article class="dashboard-item-card project-card app-loading-card">
      <div class="dashboard-project-open">
        <strong class="app-loading-line app-loading-title" data-short={props.short ? "true" : undefined} />
        <span class="app-loading-line app-loading-detail" />
        <small class="project-folder-label app-loading-line app-loading-meta" />
      </div>
      <div class="row-actions">
        <span class="app-loading-control" />
        <span class="app-loading-icon-control" />
        <span class="app-loading-icon-control" />
      </div>
    </article>
  )
}

function PlainCard(props: { short?: boolean }) {
  return (
    <article class="dashboard-item-card app-loading-card">
      <div>
        <strong class="app-loading-line app-loading-title" data-short={props.short ? "true" : undefined} />
        <span class="app-loading-line app-loading-detail" />
      </div>
      <footer>
        <small class="app-loading-line app-loading-meta" />
      </footer>
    </article>
  )
}

function StatusCard(props: { short?: boolean }) {
  return (
    <article class="dashboard-item-card dashboard-status-card interactive status-dormant app-loading-card">
      <div class="dashboard-card-open">
        <div>
          <strong class="app-loading-line app-loading-title" data-short={props.short ? "true" : undefined} />
        </div>
        <footer>
          <small class="app-loading-line app-loading-meta" />
        </footer>
      </div>
      <span class="pin-toggle app-loading-pin" />
    </article>
  )
}
