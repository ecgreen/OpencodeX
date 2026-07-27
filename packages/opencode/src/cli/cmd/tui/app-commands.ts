import { createMemo } from "solid-js"
import type { createTuiAppController } from "./app-controller"
import { createTuiAppAgentCommands } from "./app-commands-agent"
import { createTuiAppNavigationCommands } from "./app-commands-opencodex"
import { createTuiAppSystemCommands } from "./app-commands-system"
import { OPENCODE_BASE_MODE, useBindings } from "./keymap"

const appGlobalBindingCommands = [
  "session.list",
  "session.new",
  "session.quick_switch.1",
  "session.quick_switch.2",
  "session.quick_switch.3",
  "session.quick_switch.4",
  "session.quick_switch.5",
  "session.quick_switch.6",
  "session.quick_switch.7",
  "session.quick_switch.8",
  "session.quick_switch.9",
  "opencodex.sidebar.toggle",
  "opencodex.sidebar.focus",
] as const

const appBindingCommands = [
  "command.palette.show",
  "model.list",
  "opencodex.project.create",
  "opencodex.dashboard.open",
  "opencodex.swarm.list",
  "opencodex.swarm.open",
  "opencodex.swarm.create",
  "opencodex.swarm.task",
  "opencodex.project.manage",
  "opencodex.session.manage",
  "opencodex.session.new_project",
  "opencodex.view.create",
  "model.cycle_recent",
  "model.cycle_recent_reverse",
  "model.cycle_favorite",
  "model.cycle_favorite_reverse",
  "agent.list",
  "mcp.list",
  "agent.cycle",
  "agent.cycle.reverse",
  "variant.cycle",
  "variant.list",
  "provider.connect",
  "console.org.switch",
  "opencode.status",
  "theme.switch",
  "theme.switch_mode",
  "theme.mode.lock",
  "help.show",
  "docs.open",
  "workspace.list",
  "app.debug",
  "app.console",
  "app.heap_snapshot",
  "terminal.suspend",
  "terminal.title.toggle",
  "app.toggle.animations",
  "app.toggle.file_context",
  "app.toggle.diffwrap",
  "app.toggle.paste_summary",
  "app.toggle.session_directory_filter",
] as const

export function registerTuiAppCommands(controller: ReturnType<typeof createTuiAppController>) {
  const commands = createMemo(() => [
    ...createTuiAppNavigationCommands(controller),
    ...createTuiAppAgentCommands(controller),
    ...createTuiAppSystemCommands(controller),
  ].map((command) => ({ namespace: "palette", ...command })))

  useBindings(() => ({ commands: commands() }))
  useBindings(() => ({ mode: OPENCODE_BASE_MODE, bindings: controller.tuiConfig.keybinds.gather("app", appBindingCommands) }))
  useBindings(() => ({ bindings: controller.tuiConfig.keybinds.gather("app.global", appGlobalBindingCommands) }))
  useBindings(() => ({
    mode: OPENCODE_BASE_MODE,
    enabled: () => {
      const prompt = controller.promptRef.current
      return !prompt?.focused || prompt.current.input === ""
    },
    bindings: controller.tuiConfig.keybinds.gather("app_exit", ["app.exit"]),
  }))
}
