import type { createTuiAppController } from "./app-controller"
import { DialogAgent } from "./component/dialog-agent"
import { DialogMcp } from "./component/dialog-mcp"
import { DialogModel } from "./component/dialog-model"
import { DialogProviderList } from "./component/dialog-provider"
import { DialogVariant } from "./component/dialog-variant"

export function createTuiAppAgentCommands(controller: ReturnType<typeof createTuiAppController>) {
  return [
    {
      name: "model.list",
      title: "Switch model",
      suggested: true,
      category: "Agent",
      slashName: "models",
      run: () => {
        if (controller.activeStartedSwarmSession()) return controller.warnStartedSwarmSwitch()
        controller.dialog.replace(() => <DialogModel />)
      },
    },
    {
      name: "model.cycle_recent",
      title: "Model cycle",
      category: "Agent",
      hidden: true,
      run: () => controller.local.model.cycle(1),
    },
    {
      name: "model.cycle_recent_reverse",
      title: "Model cycle reverse",
      category: "Agent",
      hidden: true,
      run: () => controller.local.model.cycle(-1),
    },
    {
      name: "model.cycle_favorite",
      title: "Favorite cycle",
      category: "Agent",
      hidden: true,
      run: () => controller.local.model.cycleFavorite(1),
    },
    {
      name: "model.cycle_favorite_reverse",
      title: "Favorite cycle reverse",
      category: "Agent",
      hidden: true,
      run: () => controller.local.model.cycleFavorite(-1),
    },
    {
      name: "agent.list",
      title: "Switch agent",
      category: "Agent",
      slashName: "agents",
      run: () => controller.dialog.replace(() => <DialogAgent />),
    },
    {
      name: "mcp.list",
      title: "Toggle MCPs",
      category: "Agent",
      slashName: "mcps",
      run: () => controller.dialog.replace(() => <DialogMcp />),
    },
    {
      name: "agent.cycle",
      title: "Agent cycle",
      category: "Agent",
      hidden: true,
      run: () => cycleAgent(controller, 1),
    },
    {
      name: "agent.cycle.reverse",
      title: "Agent cycle reverse",
      category: "Agent",
      hidden: true,
      run: () => cycleAgent(controller, -1),
    },
    {
      name: "variant.cycle",
      title: "Variant cycle",
      category: "Agent",
      run: () => {
        const prompt = controller.promptRef.current
        if (prompt?.focused && prompt.cycleVariant) return prompt.cycleVariant()
        controller.local.model.variant.cycle()
      },
    },
    {
      name: "variant.list",
      title: "Switch model variant",
      category: "Agent",
      hidden: controller.local.model.variant.list().length === 0,
      slashName: "variants",
      run: () => controller.dialog.replace(() => <DialogVariant />),
    },
    {
      name: "provider.connect",
      title: "Connect provider",
      suggested: !controller.connected(),
      slashName: "connect",
      category: "Provider",
      run: () => controller.dialog.replace(() => <DialogProviderList />),
    },
  ]
}

function cycleAgent(controller: ReturnType<typeof createTuiAppController>, offset: -1 | 1) {
  const prompt = controller.promptRef.current
  if (prompt?.focused && prompt.cycleAgent) return prompt.cycleAgent(offset)
  controller.local.agent.move(offset)
}
