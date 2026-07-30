import HomeFooter from "../feature-plugins/home/footer"
import HomeTips from "../feature-plugins/home/tips"
import SidebarContext from "../feature-plugins/sidebar/context"
import SidebarMcp from "../feature-plugins/sidebar/mcp"
import SidebarLsp from "../feature-plugins/sidebar/lsp"
import SidebarTodo from "../feature-plugins/sidebar/todo"
import SidebarFiles from "../feature-plugins/sidebar/files"
import SidebarFooter from "../feature-plugins/sidebar/footer"
import PluginManager from "../feature-plugins/system/plugins"
import Notifications from "../feature-plugins/system/notifications"
import WhichKey from "../feature-plugins/system/which-key"
import DiffViewer from "../feature-plugins/system/diff-viewer"
import SessionSwitcher from "../feature-plugins/session"
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"
import type { RuntimeFlags } from "@/effect/runtime-flags"
import { internalTuiPluginManifest, type InternalTuiPluginID } from "@/plugin/internal-tui-manifest"

export type InternalTuiPlugin = Omit<TuiPluginModule, "id"> & {
  id: string
  tui: TuiPlugin
  enabled?: boolean
}

export function internalTuiPlugins(): InternalTuiPlugin[] {
  const implementations = {
    "internal:home-footer": HomeFooter,
    "internal:home-tips": HomeTips,
    "internal:sidebar-context": SidebarContext,
    "internal:sidebar-mcp": SidebarMcp,
    "internal:sidebar-lsp": SidebarLsp,
    "internal:sidebar-todo": SidebarTodo,
    "internal:sidebar-files": SidebarFiles,
    "internal:sidebar-footer": SidebarFooter,
    "internal:notifications": Notifications,
    "internal:plugin-manager": PluginManager,
    "which-key": WhichKey,
    "diff-viewer": DiffViewer,
    "internal:session-switcher": SessionSwitcher,
  } satisfies Record<InternalTuiPluginID, InternalTuiPlugin>

  return internalTuiPluginManifest().map((item) => ({ ...implementations[item.id], ...item }))
}
