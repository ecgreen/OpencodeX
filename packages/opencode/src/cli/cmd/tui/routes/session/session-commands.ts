import { createMemo } from "solid-js"
import { OPENCODE_BASE_MODE, useBindings } from "@tui/keymap"
import type { createSessionRouteController } from "./session-controller"
import { createSessionLifecycleCommands } from "./session-commands-lifecycle"
import { createSessionNavigationCommands } from "./session-commands-navigation"
import { createSessionTranscriptCommands } from "./session-commands-transcript"

const sessionBindingCommands = [
  "session.rename",
  "session.timeline",
  "session.fork",
  "session.compact",
  "session.undo",
  "session.redo",
  "session.sidebar.toggle",
  "session.toggle.conceal",
  "session.toggle.timestamps",
  "session.toggle.thinking",
  "session.toggle.actions",
  "session.toggle.scrollbar",
  "session.toggle.generic_tool_output",
  "session.load_older",
  "session.first",
  "session.last",
  "session.messages_last_user",
  "session.message.next",
  "session.message.previous",
  "messages.copy",
  "session.copy",
  "session.export",
  "session.child.first",
  "session.parent",
  "session.child.next",
  "session.child.previous",
] as const

const sessionGlobalBindingCommands = [
  "session.page.up",
  "session.page.down",
  "session.line.up",
  "session.line.down",
  "session.half.page.up",
  "session.half.page.down",
] as const

const sessionGlobalUnfocusedBindingCommands = ["session.first", "session.last"] as const

export function registerSessionCommands(controller: ReturnType<typeof createSessionRouteController>) {
  const commands = createMemo(() => [
    ...createSessionLifecycleCommands(controller),
    ...createSessionNavigationCommands(controller),
    ...createSessionTranscriptCommands(controller),
  ].map((command) => ({
    namespace: "palette",
    name: command.value,
    desc: "description" in command ? command.description : undefined,
    slashName: "slash" in command ? command.slash?.name : undefined,
    slashAliases: "slash" in command && command.slash && "aliases" in command.slash ? command.slash.aliases : undefined,
    ...command,
  })))

  useBindings(() => ({ commands: commands() }))
  useBindings(() => ({ bindings: controller.tuiConfig.keybinds.gather("session.global", sessionGlobalBindingCommands) }))
  useBindings(() => ({
    enabled: () => controller.renderer.currentFocusedEditor === null,
    bindings: controller.tuiConfig.keybinds.gather("session.global.unfocused", sessionGlobalUnfocusedBindingCommands),
  }))
  useBindings(() => ({
    mode: OPENCODE_BASE_MODE,
    bindings: controller.tuiConfig.keybinds.gather("session", sessionBindingCommands),
  }))
}
