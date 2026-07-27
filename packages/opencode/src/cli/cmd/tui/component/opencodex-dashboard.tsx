import { Toast } from "@tui/ui/toast"
import { For, Show } from "solid-js"
import { AttentionCard, DashboardCreateBar, EmptyCreateCard, ProjectCard, SessionCard, ViewCard } from "./opencodex-dashboard-cards"
import { createOpencodeXDashboardController } from "./opencodex-dashboard-controller"
import { CardGrid, EmptyRow, Section, TopLogoNav } from "./opencodex-operation-layout"
import { SwarmCard } from "./opencodex-swarm-cards"

export function OpencodeXDashboard() {
  const controller = createOpencodeXDashboardController()
  return (
    <box flexGrow={1} minHeight={0} flexDirection="column" paddingLeft={2} paddingRight={2} paddingTop={1} gap={1}>
      <box flexGrow={1} minHeight={0} flexDirection="column" gap={1}>
        <TopLogoNav onSelect={() => controller.route.navigate({ type: "opencodex-dashboard" })} />
        <DashboardCreateBar actions={controller.createActions().map((action) => ({ ...action, selected: controller.isSelected(action.id) }))} />
        <scrollbox
          flexGrow={1}
          minHeight={0}
          scrollAcceleration={controller.scrollAcceleration()}
          verticalScrollbarOptions={{ trackOptions: { backgroundColor: controller.theme.backgroundElement, foregroundColor: controller.theme.border } }}
        >
          <Section
            title="Projects"
            count={controller.projectSummaries().length}
            collapsible
            collapsed={controller.projectsCollapsed()}
            selected={controller.isSelected("section:projects")}
            onSelect={() => controller.selectByID("section:projects")}
            onToggle={() => controller.setProjectsCollapsed((value) => !value)}
            action={controller.selectedProjectID() ? { label: "All projects", selected: controller.isSelected("action:clear-project"), onSelect: controller.clearProject } : undefined}
          >
            <CardGrid>
              <Show
                when={controller.projectSummaries().length > 0}
                fallback={<EmptyCreateCard title="Create project" description="Group sessions, swarms, and views around a workspace." width={controller.cardWidth()} actionLabel="create" selected={controller.isSelected("empty:projects")} onCreate={controller.createProject} />}
              >
                <For each={controller.projectSummaries()}>
                  {(summary) => <ProjectCard summary={summary} width={controller.cardWidth()} selected={controller.isSelected(`project:${summary.project.id}`)} active={controller.selectedProjectID() === summary.project.id} onSelect={() => controller.selectProject(summary.project.id)} />}
                </For>
              </Show>
            </CardGrid>
          </Section>

          <Section
            title="Attention Needed"
            count={controller.attentionRows().length}
            collapsible
            collapsed={controller.attentionCollapsed()}
            selected={controller.isSelected("section:attention")}
            onSelect={() => controller.selectByID("section:attention")}
            onToggle={() => controller.setAttentionCollapsed((value) => !value)}
          >
            <Show when={controller.attentionRows().length > 0} fallback={<EmptyRow text={controller.selectedProject() ? "Nothing needs attention in this project." : "Nothing needs attention right now."} />}>
              <CardGrid><For each={controller.attentionRows()}>{(row) => <AttentionCard row={row} width={controller.cardWidth()} selected={controller.isSelected(`attention:${row.id}`)} />}</For></CardGrid>
            </Show>
          </Section>

          <Section
            title={controller.sessionSectionTitle()}
            count={controller.primarySessionRows().length}
            collapsible
            collapsed={controller.sessionsCollapsed()}
            selected={controller.isSelected("section:sessions")}
            onSelect={() => controller.selectByID("section:sessions")}
            onToggle={() => controller.setSessionsCollapsed((value) => !value)}
          >
            <CardGrid>
              <Show when={controller.primarySessionRows().length > 0} fallback={<EmptyCreateCard title="Create session" description="Start a new chat from the dashboard." width={controller.cardWidth()} selected={controller.isSelected("empty:sessions")} onCreate={controller.createSession} />}>
                <For each={controller.primarySessionRows()}>{(row) => <SessionCard session={row.session} projects={controller.projects()} swarms={controller.swarms()} width={controller.cardWidth()} displayStatus={row.dashboardStatus} selected={controller.isSelected(row.id)} />}</For>
              </Show>
            </CardGrid>
          </Section>

          <Section
            title="Swarms"
            count={controller.swarmRows().length}
            collapsible
            collapsed={controller.swarmsCollapsed()}
            selected={controller.isSelected("section:swarms")}
            onSelect={() => controller.selectByID("section:swarms")}
            onToggle={() => controller.setSwarmsCollapsed((value) => !value)}
          >
            <CardGrid>
              <Show when={controller.swarmRows().length > 0} fallback={<EmptyCreateCard title="Create swarm" description="Build an Agent team" width={controller.cardWidth()} selected={controller.isSelected("empty:swarms")} onCreate={controller.createSwarm} />}>
                <For each={controller.swarmRows()}>{(row) => <SwarmCard swarm={row.swarm} projects={controller.projects()} width={controller.cardWidth()} displayStatus={row.status} selected={controller.isSelected(row.id)} showStatusDot={false} />}</For>
              </Show>
            </CardGrid>
          </Section>

          <Section
            title="Views"
            count={controller.viewRows().length}
            collapsible
            collapsed={controller.viewsCollapsed()}
            selected={controller.isSelected("section:views")}
            onSelect={() => controller.selectByID("section:views")}
            onToggle={() => controller.setViewsCollapsed((value) => !value)}
          >
            <CardGrid>
              <Show when={controller.viewRows().length > 0} fallback={<EmptyCreateCard title="Create view" description="Build a focused multi-session view." width={controller.cardWidth()} actionLabel="create" selected={controller.isSelected("empty:views")} onCreate={() => void controller.createView()} />}>
                <For each={controller.viewRows()}>{(row) => <ViewCard view={row.view} status={row.dashboardStatus ?? "dormant"} width={controller.cardWidth()} selected={controller.isSelected(row.id)} />}</For>
              </Show>
            </CardGrid>
          </Section>

          <Section
            title={controller.priorSessionSectionTitle()}
            count={controller.priorSessionRows().length}
            collapsible
            collapsed={controller.priorSessionsCollapsed()}
            selected={controller.isSelected("section:prior-sessions")}
            onSelect={() => controller.selectByID("section:prior-sessions")}
            onToggle={() => controller.setPriorSessionsCollapsed((value) => !value)}
          >
            <Show when={controller.priorSessionRows().length > 0} fallback={<EmptyRow text="No prior sessions." />}>
              <CardGrid><For each={controller.priorSessionRows()}>{(row) => <SessionCard session={row.session} projects={controller.projects()} swarms={controller.swarms()} width={controller.cardWidth()} displayStatus={row.dashboardStatus} selected={controller.isSelected(row.id)} />}</For></CardGrid>
            </Show>
          </Section>
        </scrollbox>
      </box>
      <text fg={controller.theme.textMuted}>{controller.shortcutHint()}</text>
      <Toast />
    </box>
  )
}
