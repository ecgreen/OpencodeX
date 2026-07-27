import { TextAttributes } from "@opentui/core"
import { Toast } from "@tui/ui/toast"
import { For, Show } from "solid-js"
import { projectTitle } from "./opencodex-operation-model"
import { EmptyRow, Section, TopLogoNav } from "./opencodex-operation-layout"
import { SwarmAddAgentCard, SwarmCreateRow, SwarmRoleDraftCard } from "./opencodex-swarm-create-cards"
import { createOpencodeXSwarmCreateController } from "./opencodex-swarm-create-controller"

export function OpencodeXSwarmCreate() {
  const controller = createOpencodeXSwarmCreateController()
  return (
    <box flexGrow={1} minHeight={0} flexDirection="column" paddingLeft={2} paddingRight={2} paddingTop={1} gap={1}>
      <TopLogoNav label="DASHBOARD" onSelect={() => controller.route.navigate({ type: "opencodex-dashboard" })} />
      <scrollbox
        flexGrow={1}
        minHeight={0}
        scrollAcceleration={controller.scrollAcceleration()}
        verticalScrollbarOptions={{ trackOptions: { backgroundColor: controller.theme.backgroundElement, foregroundColor: controller.theme.border } }}
      >
        <box width="100%" maxWidth={controller.promptMaxWidth()} flexDirection="column" gap={1}>
          <box flexDirection="column" gap={0}>
            <text attributes={TextAttributes.BOLD} fg={controller.theme.primary}>{controller.editing() ? "Edit swarm" : "Create swarm"}</text>
            <text fg={controller.theme.textMuted}>
              {controller.editing() ? "Update the swarm name, orchestrator, and specialist config." : "Pick the project, set the orchestrator first, then select reusable specialist roles."}
            </text>
          </box>
          <Show when={(controller.projects() ?? []).length > 0} fallback={<EmptyRow text="Create an OpencodeX project before starting a swarm." />}>
            <SwarmCreateRow
              title="Project"
              value={controller.projectID() ? projectTitle(controller.projects() ?? [], controller.projectID()) : "Select project"}
              description="Where this swarm's task sessions will run."
              required={!controller.editing()}
              selected={!controller.editing() && controller.isSelected("project")}
              onSelect={() => !controller.editing() && controller.selectProject()}
            />
            <SwarmCreateRow title="Title" value={controller.title().trim() || "Optional; first task can name the swarm later"} selected={controller.isSelected("title")} onSelect={() => void controller.editTitle()} />
            <Section title="Orchestrator">
              <SwarmCreateRow title="Name" value={controller.orchestrator().name} description="The orchestrator is always the first swarm role." required selected={controller.isSelected("orchestrator-name")} onSelect={() => void controller.editOrchestratorName()} />
              <SwarmRoleDraftCard
                role={controller.orchestrator()}
                selected={controller.isSelected("orchestrator-model") || controller.isSelected("orchestrator-instructions")}
                selectedModel={controller.isSelected("orchestrator-model")}
                selectedInstructions={controller.isSelected("orchestrator-instructions")}
                providers={controller.sync.data.provider}
                modelRequired
                onSelect={() => void controller.editInstructions("orchestrator")}
                onModel={() => controller.selectModel("orchestrator")}
                onInstructions={() => void controller.editInstructions("orchestrator")}
              />
            </Section>
            <Section title="Specialists" count={controller.selectedRoles().length} required>
              <Show when={controller.roles().length > 0} fallback={<EmptyRow text="No specialist roles assigned yet." />}>
                <For each={controller.roles()}>
                  {(role) => (
                    <SwarmRoleDraftCard
                      role={role}
                      selected={controller.isSelected(`role:${role.draftID}`) || controller.isSelected(`role-model:${role.draftID}`) || controller.isSelected(`role-instructions:${role.draftID}`) || controller.isSelected(`role-remove:${role.draftID}`)}
                      selectedModel={controller.isSelected(`role-model:${role.draftID}`)}
                      selectedInstructions={controller.isSelected(`role:${role.draftID}`) || controller.isSelected(`role-instructions:${role.draftID}`)}
                      selectedRemove={controller.isSelected(`role-remove:${role.draftID}`)}
                      providers={controller.sync.data.provider}
                      modelRequired
                      onSelect={() => void controller.editInstructions(role.draftID)}
                      onModel={() => controller.selectModel(role.draftID)}
                      onInstructions={() => void controller.editInstructions(role.draftID)}
                      onRemove={() => controller.removeRole(role.draftID)}
                    />
                  )}
                </For>
              </Show>
              <SwarmAddAgentCard selected={controller.isSelected("add-agent")} disabled={controller.availableRoles().length === 0} onSelect={() => void controller.addAgent()} />
            </Section>
            <box flexDirection="column" gap={0}>
              <box paddingLeft={1} paddingRight={1} paddingTop={1} paddingBottom={1} backgroundColor={controller.theme.backgroundPanel} border={["left"]} borderColor={controller.isSelected("create") ? controller.theme.primary : controller.theme.success} onMouseUp={() => void controller.saveSwarm()}>
                <text attributes={TextAttributes.BOLD} fg={controller.creating() ? controller.theme.textMuted : controller.theme.success}>
                  {controller.creating() ? (controller.editing() ? "Saving..." : "Creating...") : controller.editing() ? "Save swarm" : "Create swarm"}
                </text>
                <text fg={controller.theme.textMuted}>{controller.editing() ? "Updates this reusable swarm configuration." : "Creates the reusable swarm; assign tasks from the swarm page prompt bar."}</text>
              </box>
              <box paddingLeft={1} paddingRight={1} paddingTop={1} paddingBottom={1} backgroundColor={controller.theme.backgroundPanel} border={["left"]} borderColor={controller.isSelected("cancel") ? controller.theme.primary : controller.theme.textMuted} onMouseUp={controller.cancelCreate}>
                <text attributes={TextAttributes.BOLD} fg={controller.theme.text}>Cancel</text>
                <text fg={controller.theme.textMuted}>{controller.editing() ? "Return to this swarm without saving changes." : "Return to swarms without creating this swarm."}</text>
              </box>
            </box>
          </Show>
        </box>
      </scrollbox>
      <text fg={controller.theme.textMuted}>Use arrows or j/k to move, tab to cycle, enter to edit, esc to cancel.</text>
      <Toast />
    </box>
  )
}
