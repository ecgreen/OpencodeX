import { TextAttributes } from "@opentui/core"
import { isActiveSwarmStatus } from "@opencode-ai/sdk/v2/swarm-presentation"
import { Prompt } from "@tui/component/prompt"
import { useRoute } from "@tui/context/route"
import { Toast } from "@tui/ui/toast"
import { For, Match, Show, Switch } from "solid-js"
import { swarmRunPlaceholder } from "./opencodex-operation-bindings"
import { CardGrid, EmptyRow, Section, TopLogoNav } from "./opencodex-operation-layout"
import {
  isOrchestratorSwarmRole,
  projectTitle,
  statusColor,
  statusDot,
  timeAgo,
  truncate,
} from "./opencodex-operation-model"
import { SwarmAgentCard, SwarmCard, SwarmEmptyState, SwarmNewTaskCard } from "./opencodex-swarm-cards"
import { OpencodeXSwarmCreate } from "./opencodex-swarm-create"
import { createOpencodeXSwarmsController } from "./opencodex-swarms-controller"

export function OpencodeXSwarms() {
  const route = useRoute()
  return (
    <Switch>
      <Match when={route.data.type === "opencodex-swarm-create"}><OpencodeXSwarmCreate /></Match>
      <Match when={true}><OpencodeXSwarmsPage /></Match>
    </Switch>
  )
}

function OpencodeXSwarmsPage() {
  const controller = createOpencodeXSwarmsController()
  return (
    <box flexGrow={1} minHeight={0} flexDirection="column" paddingLeft={2} paddingRight={2} paddingTop={1} gap={1}>
      <box flexGrow={1} minHeight={0} flexDirection="column" gap={1}>
        <TopLogoNav label="DASHBOARD" onSelect={() => controller.route.navigate({ type: "opencodex-dashboard" })} />
        <scrollbox
          flexGrow={1}
          minHeight={0}
          scrollAcceleration={controller.scrollAcceleration()}
          verticalScrollbarOptions={{ trackOptions: { backgroundColor: controller.theme.backgroundElement, foregroundColor: controller.theme.border } }}
        >
          <Show when={!(controller.route.data.type === "opencodex-swarms" && controller.route.data.swarmID)}>
            <Show when={controller.list().length > 0} fallback={<SwarmEmptyState width={controller.detailMaxWidth()} onCreate={controller.createSwarm} />}>
              <Section title="Active swarms" count={controller.active().length} collapsible collapsed={controller.activeCollapsed()} onToggle={controller.toggleActive}>
                <Show when={controller.active().length > 0} fallback={<EmptyRow text="No active swarms." />}>
                  <CardGrid><For each={controller.active()}>{(swarm) => <SwarmCard swarm={swarm} projects={controller.projects()} width={controller.cardWidth()} displayStatus={controller.displaySwarmStatus(swarm)} />}</For></CardGrid>
                </Show>
              </Section>
              <Section title="Inactive swarms" count={controller.inactive().length} collapsible collapsed={controller.inactiveCollapsed()} onToggle={controller.toggleInactive}>
                <Show when={controller.inactive().length > 0} fallback={<EmptyRow text="No inactive swarms." />}>
                  <CardGrid><For each={controller.inactive()}>{(swarm) => <SwarmCard swarm={swarm} projects={controller.projects()} width={controller.cardWidth()} displayStatus={controller.displaySwarmStatus(swarm)} />}</For></CardGrid>
                </Show>
              </Section>
            </Show>
          </Show>

          <Show when={controller.route.data.type === "opencodex-swarms" && controller.route.data.swarmID}>
            <Section title="Swarm">
              <Show when={controller.current()} fallback={<EmptyRow text="Swarm not found." />}>
                {(swarm) => (
                  <CardGrid>
                    <box width={Math.min(controller.detailMaxWidth(), 52)} flexShrink={0} flexDirection="column" gap={0} paddingLeft={1} paddingRight={1} paddingTop={1} paddingBottom={1} backgroundColor={controller.theme.backgroundPanel} border={["left"]} borderColor={statusColor(controller.displaySwarmStatus(swarm()), controller.theme)}>
                      <box width="100%" flexDirection="row" justifyContent="space-between">
                        <box flexDirection="row" gap={1}>
                          <text fg={statusColor(controller.displaySwarmStatus(swarm()), controller.theme)}>{statusDot(controller.displaySwarmStatus(swarm()))}</text>
                          <text attributes={TextAttributes.BOLD} fg={controller.theme.text}>{truncate(swarm().title, 62)}</text>
                        </box>
                        <box flexDirection="row" gap={2}>
                          <text fg={controller.theme.primary} onMouseUp={() => controller.route.navigate({ type: "opencodex-swarm-create", swarmID: swarm().id })}>edit</text>
                          <Show when={isActiveSwarmStatus(controller.displaySwarmStatus(swarm()))}><text fg={controller.theme.warning} onMouseUp={() => void controller.cancelSwarm(swarm())}>cancel</text></Show>
                          <text fg={controller.theme.error} onMouseUp={() => void controller.removeSwarm(swarm())}>delete</text>
                        </box>
                      </box>
                      <text fg={controller.theme.textMuted}>{swarm().projectID ? projectTitle(controller.projects(), swarm().projectID) : "Any project"} - {timeAgo(swarm().timeUpdated)}</text>
                      <text fg={swarm().prompt ? controller.theme.text : controller.theme.textMuted}>{swarm().prompt ? truncate(swarm().prompt, 48) : "No tasks yet."}</text>
                    </box>
                    <SwarmNewTaskCard width={controller.cardWidth()} selected onSelect={() => controller.newTask(swarm())} />
                  </CardGrid>
                )}
              </Show>
            </Section>
            <Section title="Team" count={controller.current()?.roles.length} collapsible>
              <Show when={controller.current()} fallback={<EmptyRow text="Swarm not found." />}>
                {(swarm) => <Show when={swarm().roles.length > 0} fallback={<EmptyRow text="No roles assigned to this swarm." />}><CardGrid><For each={swarm().roles}>{(role) => <SwarmAgentCard role={role} width={controller.cardWidth()} lead={isOrchestratorSwarmRole(role)} />}</For></CardGrid></Show>}
              </Show>
            </Section>
          </Show>
        </scrollbox>
      </box>
      <Show when={controller.shortcutHint()}><text fg={controller.theme.textMuted}>{controller.shortcutHint()}</text></Show>
      <Show when={controller.route.data.type === "opencodex-swarms" && !controller.route.data.swarmID}>
        <box width="100%" zIndex={1000} paddingTop={1} flexShrink={0} alignItems="center">
          <box width="100%" maxWidth={controller.promptMaxWidth()}>
            <Prompt ref={controller.bindPrompt} draftKey={`opencodex-swarm:${controller.promptTarget()?.id ?? "none"}`} onCustomSubmit={controller.startRun} placeholders={swarmRunPlaceholder} targetLabel={controller.promptTarget()?.title ?? "No swarm selected"} />
          </box>
        </box>
      </Show>
      <Toast />
    </box>
  )
}
