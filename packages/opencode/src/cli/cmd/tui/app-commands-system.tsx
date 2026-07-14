import open from "open"
import type { createTuiAppController } from "./app-controller"
import { DialogStatus } from "./component/dialog-status"
import { DialogThemeList } from "./component/dialog-theme-list"
import { DialogHelp } from "./ui/dialog-help"

export function createTuiAppSystemCommands(controller: ReturnType<typeof createTuiAppController>) {
  return [
    {
      name: "opencode.status",
      title: "View status",
      slashName: "status",
      category: "System",
      run: () => controller.dialog.replace(() => <DialogStatus />),
    },
    {
      name: "theme.switch",
      title: "Switch theme",
      slashName: "themes",
      category: "System",
      run: () => controller.dialog.replace(() => <DialogThemeList />),
    },
    {
      name: "theme.switch_mode",
      title: controller.themeState.mode() === "dark" ? "Switch to light mode" : "Switch to dark mode",
      category: "System",
      run: () => {
        controller.themeState.setMode(controller.themeState.mode() === "dark" ? "light" : "dark")
        controller.dialog.clear()
      },
    },
    {
      name: "theme.mode.lock",
      title: controller.themeState.locked() ? "Unlock theme mode" : "Lock theme mode",
      category: "System",
      run: () => {
        const update = controller.themeState.locked() ? controller.themeState.unlock : controller.themeState.lock
        update()
        controller.dialog.clear()
      },
    },
    {
      name: "help.show",
      title: "Help",
      slashName: "help",
      category: "System",
      run: () => controller.dialog.replace(() => <DialogHelp />),
    },
    {
      name: "docs.open",
      title: "Open docs",
      category: "System",
      run: () => {
        open("https://opencode.ai/docs").catch(() => {})
        controller.dialog.clear()
      },
    },
    {
      name: "app.exit",
      title: "Exit the app",
      slashName: "exit",
      slashAliases: ["quit", "q"],
      category: "System",
      run: () => controller.exit(),
    },
    {
      name: "app.debug",
      title: "Toggle debug panel",
      category: "System",
      run: () => {
        controller.renderer.toggleDebugOverlay()
        controller.dialog.clear()
      },
    },
    {
      name: "app.console",
      title: "Toggle console",
      category: "System",
      run: () => {
        controller.renderer.console.toggle()
        controller.dialog.clear()
      },
    },
    {
      name: "app.heap_snapshot",
      title: "Write heap snapshot",
      category: "System",
      run: async () => {
        const files = await controller.props.onSnapshot?.()
        controller.toast.show({ variant: "info", message: `Heap snapshot written to ${files?.join(", ")}`, duration: 5000 })
        controller.dialog.clear()
      },
    },
    {
      name: "terminal.suspend",
      title: "Suspend terminal",
      category: "System",
      hidden: true,
      enabled: process.platform !== "win32",
      run: () => {
        process.once("SIGCONT", () => controller.renderer.resume())
        controller.renderer.suspend()
        process.kill(0, "SIGTSTP")
      },
    },
    {
      name: "terminal.title.toggle",
      title: controller.terminalTitleEnabled() ? "Disable terminal title" : "Enable terminal title",
      category: "System",
      run: () => {
        controller.setTerminalTitleEnabled((enabled) => {
          const next = !enabled
          controller.kv.set("terminal_title_enabled", next)
          if (!next) controller.renderer.setTerminalTitle("")
          return next
        })
        controller.dialog.clear()
      },
    },
    toggleCommand(controller, "app.toggle.animations", "animations_enabled", "animations"),
    toggleCommand(controller, "app.toggle.file_context", "file_context_enabled", "file context"),
    {
      name: "app.toggle.diffwrap",
      title: controller.kv.get("diff_wrap_mode", "word") === "word" ? "Disable diff wrapping" : "Enable diff wrapping",
      category: "System",
      run: () => {
        controller.kv.set("diff_wrap_mode", controller.kv.get("diff_wrap_mode", "word") === "word" ? "none" : "word")
        controller.dialog.clear()
      },
    },
    {
      name: "app.toggle.paste_summary",
      title: controller.pasteSummaryEnabled() ? "Disable paste summary" : "Enable paste summary",
      category: "System",
      run: () => {
        controller.setPasteSummaryEnabled((enabled) => {
          controller.kv.set("paste_summary_enabled", !enabled)
          return !enabled
        })
        controller.dialog.clear()
      },
    },
    {
      name: "app.toggle.session_directory_filter",
      title: controller.kv.get("session_directory_filter_enabled", true)
        ? "Disable session directory filtering"
        : "Enable session directory filtering",
      category: "System",
      run: async () => {
        controller.kv.set("session_directory_filter_enabled", !controller.kv.get("session_directory_filter_enabled", true))
        await controller.sync.session.refresh()
        controller.dialog.clear()
      },
    },
    {
      name: "app.state.retry",
      title: "Retry server connection",
      category: "System",
      suggested: ["reconnecting", "error"].includes(controller.sync.stateSync.lifecycle.status),
      run: async () => {
        await controller.sync.stateSync.retry()
        controller.dialog.clear()
      },
    },
  ]
}

function toggleCommand(
  controller: ReturnType<typeof createTuiAppController>,
  name: string,
  key: "animations_enabled" | "file_context_enabled",
  label: string,
) {
  return {
    name,
    title: `${controller.kv.get(key, true) ? "Disable" : "Enable"} ${label}`,
    category: "System",
    run: () => {
      controller.kv.set(key, !controller.kv.get(key, true))
      controller.dialog.clear()
    },
  }
}
