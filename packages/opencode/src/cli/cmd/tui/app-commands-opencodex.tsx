import { Flag } from "@opencode-ai/core/flag/flag"
import { CommandPaletteDialog } from "./component/command-palette"
import { DialogSessionList } from "./component/dialog-session-list"
import { DialogWorkspaceList } from "./component/dialog-workspace-list"
import {
  createOpencodeXProjectDialog,
  focusOpencodeXSidebar,
  manageOpencodeXProjectsDialog,
  manageOpencodeXSessionsDialog,
  newOpencodeXSessionInProjectDialog,
} from "./component/opencodex-sidebar"
import {
  createOpencodeXSwarmDialog,
  selectOpencodeXSwarmDialog,
  selectOpencodeXSwarmTaskDialog,
} from "./component/opencodex-operations"
import { setPendingOpencodeXProjectSession, setPendingOpencodeXSwarmTask } from "./component/opencodex-session-state"
import {
  createOpencodeXViewDialog,
  deleteOpencodeXViewDialog,
  editOpencodeXViewDialog,
  selectOpencodeXViewDialog,
} from "./component/opencodex-view-dialog"
import type { createTuiAppController } from "./app-controller"
import { COMMAND_PALETTE_COMMAND } from "./keymap"
import { Clipboard } from "./util/clipboard"

export function createTuiAppNavigationCommands(controller: ReturnType<typeof createTuiAppController>) {
  return [
    {
      name: COMMAND_PALETTE_COMMAND,
      title: "Show command palette",
      category: "System",
      hidden: true,
      run: () => controller.dialog.replace(() => <CommandPaletteDialog />),
    },
    {
      name: "session.list",
      title: "Switch session",
      category: "Session",
      suggested: controller.sync.data.session.length > 0,
      slashName: "sessions",
      slashAliases: ["resume", "continue"],
      run: () => controller.dialog.replace(() => <DialogSessionList />),
    },
    {
      name: "session.new",
      title: "New session",
      suggested: controller.route.data.type === "session",
      category: "Session",
      slashName: "new",
      slashAliases: ["clear"],
      run: () => {
        setPendingOpencodeXProjectSession(undefined)
        setPendingOpencodeXSwarmTask(undefined)
        controller.route.navigate({ type: "home" })
        controller.dialog.clear()
      },
    },
    {
      name: "opencodex.dashboard.open",
      title: "Open operations dashboard",
      suggested: true,
      category: "OpencodeX",
      slashName: "dashboard",
      slashAliases: ["ops", "operations", "opencodex"],
      run: () => {
        controller.route.navigate({ type: "opencodex-dashboard" })
        controller.dialog.clear()
      },
    },
    {
      name: "opencodex.project.create",
      title: "Create project",
      suggested: true,
      category: "OpencodeX",
      slashName: "project",
      run: () => void createOpencodeXProjectDialog({ sdk: controller.sdk, dialog: controller.dialog, theme: controller.themeState.theme }),
    },
    {
      name: "opencodex.swarm.list",
      title: "Show swarms on dashboard",
      suggested: true,
      category: "Swarms",
      slashName: "swarm-dash",
      slashAliases: ["swarms", "swarm-list"],
      run: () => {
        controller.route.navigate({ type: "opencodex-dashboard" })
        controller.dialog.clear()
      },
    },
    {
      name: "opencodex.swarm.open",
      title: "Open swarm",
      suggested: true,
      category: "Swarms",
      slashName: "open-swarm",
      run: () => void selectOpencodeXSwarmDialog({ sdk: controller.sdk, dialog: controller.dialog, route: controller.route }),
    },
    {
      name: "opencodex.swarm.create",
      title: "Create swarm",
      suggested: true,
      category: "Swarms",
      slashName: "new-swarm",
      run: () => void createOpencodeXSwarmDialog({ sdk: controller.sdk, dialog: controller.dialog, route: controller.route, theme: controller.themeState.theme }),
    },
    {
      name: "opencodex.swarm.task",
      title: "New swarm task",
      suggested: true,
      category: "Swarms",
      slashName: "swarm",
      run: () => {
        if (controller.activeStartedSwarmSession()) return controller.warnStartedSwarmSwitch()
        void selectOpencodeXSwarmTaskDialog({ sdk: controller.sdk, dialog: controller.dialog, route: controller.route })
      },
    },
    {
      name: "opencodex.view.open",
      title: "Open View",
      suggested: true,
      category: "Views",
      slashName: "view",
      slashAliases: ["views", "open-view"],
      run: () => selectOpencodeXViewDialog({ sdk: controller.sdk, dialog: controller.dialog, route: controller.route }),
    },
    {
      name: "opencodex.view.create",
      title: "Create view",
      suggested: true,
      category: "Views",
      slashName: "new-view",
      slashAliases: ["create-view"],
      run: () => void createOpencodeXViewDialog({
        sdk: controller.sdk,
        dialog: controller.dialog,
        route: controller.route,
        sessionIDs: controller.route.data.type === "session" ? [controller.route.data.sessionID] : undefined,
      }),
    },
    {
      name: "opencodex.view.edit",
      title: "Edit view",
      suggested: true,
      category: "Views",
      slashName: "edit-view",
      run: () => void editOpencodeXViewDialog({ sdk: controller.sdk, dialog: controller.dialog, route: controller.route }),
    },
    {
      name: "opencodex.view.delete",
      title: "Delete view",
      suggested: true,
      category: "Views",
      slashName: "delete-view",
      run: () => deleteOpencodeXViewDialog({ sdk: controller.sdk, dialog: controller.dialog, route: controller.route }),
    },
    {
      name: "opencodex.session.new_project",
      title: "New session in project",
      suggested: true,
      category: "OpencodeX",
      slashName: "nsip",
      slashAliases: ["new-session-in-project"],
      run: () => void newOpencodeXSessionInProjectDialog({ sdk: controller.sdk, dialog: controller.dialog, theme: controller.themeState.theme, route: controller.route, sync: controller.sync }),
    },
    {
      name: "opencodex.session.manage",
      title: "Manage sessions",
      suggested: true,
      category: "OpencodeX",
      run: () => manageOpencodeXSessionsDialog({ sdk: controller.sdk, dialog: controller.dialog, theme: controller.themeState.theme, route: controller.route, sync: controller.sync }),
    },
    {
      name: "opencodex.project.manage",
      title: "Manage projects",
      suggested: true,
      category: "OpencodeX",
      run: () => manageOpencodeXProjectsDialog({ sdk: controller.sdk, dialog: controller.dialog, theme: controller.themeState.theme, sync: controller.sync }),
    },
    {
      name: "opencodex.sidebar.toggle",
      title: "Toggle sidebar",
      suggested: true,
      category: "OpencodeX",
      run: () => controller.setOxSidebarOpen((open) => !open),
    },
    {
      name: "opencodex.sidebar.focus",
      title: "Focus sidebar",
      suggested: true,
      category: "OpencodeX",
      run: () => {
        controller.setOxSidebarOpen(() => true)
        focusOpencodeXSidebar()
      },
    },
    {
      name: "workspace.copy_path",
      title: "Copy worktree path",
      category: "Workspace",
      enabled: () => controller.currentWorktreeWorkspace() !== undefined,
      run: async () => {
        const workspace = controller.currentWorktreeWorkspace()
        if (!workspace?.directory) return
        await Clipboard.copy(workspace.directory)
          .then(() => controller.toast.show({ message: "Copied worktree path", variant: "info" }))
          .catch(controller.toast.error)
        controller.dialog.clear()
      },
    },
    {
      name: "workspace.list",
      title: "Manage workspaces",
      category: "Workspace",
      hidden: !Flag.OPENCODE_EXPERIMENTAL_WORKSPACES,
      slashName: "workspaces",
      run: () => controller.dialog.replace(() => <DialogWorkspaceList />),
    },
    ...Array.from({ length: 9 }, (_, index) => ({
      name: `session.quick_switch.${index + 1}`,
      title: `Switch to session in quick slot ${index + 1}`,
      category: "Session",
      hidden: true,
      run: () => controller.local.session.quickSwitch(index + 1),
    })),
  ]
}
