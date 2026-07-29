import { batch } from "solid-js"
import { nextThinkingMode } from "@tui/context/thinking"
import type { createSessionRouteController } from "./session-controller"

export function createSessionNavigationCommands(controller: ReturnType<typeof createSessionRouteController>) {
  const scroll = () => controller.scroll()
  return [
    {
      title: controller.sidebarVisible() ? "Hide sidebar" : "Show sidebar",
      value: "session.sidebar.toggle",
      category: "Session",
      run: () => {
        batch(() => {
          const visible = controller.sidebarVisible()
          controller.setSidebar(() => visible ? "hide" : "auto")
          controller.setSidebarOpen(!visible)
        })
        controller.dialog.clear()
      },
    },
    {
      title: controller.conceal() ? "Disable code concealment" : "Enable code concealment",
      value: "session.toggle.conceal",
      category: "Session",
      run: () => {
        controller.setConceal((value) => !value)
        controller.dialog.clear()
      },
    },
    {
      title: controller.showTimestamps() ? "Hide timestamps" : "Show timestamps",
      value: "session.toggle.timestamps",
      category: "Session",
      slash: { name: "timestamps", aliases: ["toggle-timestamps"] },
      run: () => {
        controller.setTimestamps((value) => value === "show" ? "hide" : "show")
        controller.dialog.clear()
      },
    },
    {
      title: nextThinkingMode(controller.thinkingMode()) === "hide" ? "Collapse thinking" : "Expand thinking",
      value: "session.toggle.thinking",
      category: "Session",
      slash: { name: "thinking", aliases: ["toggle-thinking"] },
      run: () => {
        controller.thinking.set(nextThinkingMode(controller.thinkingMode()))
        controller.dialog.clear()
      },
    },
    {
      title: controller.showDetails() ? "Hide tool details" : "Show tool details",
      value: "session.toggle.actions",
      category: "Session",
      run: () => {
        controller.setShowDetails((value) => !value)
        controller.dialog.clear()
      },
    },
    {
      title: "Toggle session scrollbar",
      value: "session.toggle.scrollbar",
      category: "Session",
      run: () => {
        controller.setShowScrollbar((value) => !value)
        controller.dialog.clear()
      },
    },
    {
      title: controller.showGenericToolOutput() ? "Hide generic tool output" : "Show generic tool output",
      value: "session.toggle.generic_tool_output",
      category: "Session",
      run: () => {
        controller.setShowGenericToolOutput((value) => !value)
        controller.dialog.clear()
      },
    },
    scrollCommand(controller, "Page up", "session.page.up", () => -scroll().height / 2),
    scrollCommand(controller, "Page down", "session.page.down", () => scroll().height / 2),
    scrollCommand(controller, "Line up", "session.line.up", () => -1),
    scrollCommand(controller, "Line down", "session.line.down", () => 1),
    scrollCommand(controller, "Half page up", "session.half.page.up", () => -scroll().height / 4),
    scrollCommand(controller, "Half page down", "session.half.page.down", () => scroll().height / 4),
    {
      title: "Load older messages",
      value: "session.load_older",
      category: "Session",
      enabled: controller.transcript().hasOlder,
      run: () => {
        void controller.loadOlderMessages()
        controller.dialog.clear()
      },
    },
    {
      title: "First message",
      value: "session.first",
      category: "Session",
      hidden: true,
      run: () => {
        scroll().scrollTo(0)
        controller.dialog.clear()
      },
    },
    {
      title: "Last message",
      value: "session.last",
      category: "Session",
      hidden: true,
      run: () => {
        scroll().scrollTo(scroll().scrollHeight)
        controller.dialog.clear()
      },
    },
    {
      title: "Jump to last user message",
      value: "session.messages_last_user",
      category: "Session",
      hidden: true,
      run: () => {
        const message = (controller.sync.data.message[controller.route.sessionID] ?? []).findLast((item) =>
          item.role === "user" && (controller.sync.data.part[item.id] ?? [])
            .some((part) => part.type === "text" && !part.synthetic && !part.ignored),
        )
        if (!message) return
        const child = scroll().getChildren().find((item) => item.id === message.id)
        if (child) scroll().scrollBy(child.y - scroll().y - 1)
      },
    },
    {
      title: "Next message",
      value: "session.message.next",
      category: "Session",
      hidden: true,
      run: () => controller.scrollToMessage("next", controller.dialog),
    },
    {
      title: "Previous message",
      value: "session.message.previous",
      category: "Session",
      hidden: true,
      run: () => controller.scrollToMessage("prev", controller.dialog),
    },
  ]
}

function scrollCommand(
  controller: ReturnType<typeof createSessionRouteController>,
  title: string,
  value: string,
  offset: () => number,
) {
  return {
    title,
    value,
    category: "Session",
    hidden: true,
    run: () => {
      controller.scroll().scrollBy(offset())
      controller.dialog.clear()
    },
  }
}
