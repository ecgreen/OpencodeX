import { Flag } from "@opencode-ai/core/flag/flag"
import type { RuntimeFlags } from "@/effect/runtime-flags"

export type InternalTuiPluginID =
  | "internal:home-footer"
  | "internal:home-tips"
  | "internal:sidebar-context"
  | "internal:sidebar-mcp"
  | "internal:sidebar-lsp"
  | "internal:sidebar-todo"
  | "internal:sidebar-files"
  | "internal:sidebar-footer"
  | "internal:notifications"
  | "internal:plugin-manager"
  | "which-key"
  | "diff-viewer"
  | "internal:session-switcher"

export type InternalTuiPluginManifestItem = {
  readonly id: InternalTuiPluginID
  readonly enabled?: boolean
}

export function internalTuiPluginManifest(): InternalTuiPluginManifestItem[] {
  return [
    { id: "internal:home-footer" },
    { id: "internal:home-tips" },
    { id: "internal:sidebar-context" },
    { id: "internal:sidebar-mcp" },
    { id: "internal:sidebar-lsp" },
    { id: "internal:sidebar-todo" },
    { id: "internal:sidebar-files" },
    { id: "internal:sidebar-footer" },
    { id: "internal:notifications" },
    { id: "internal:plugin-manager" },
    { id: "which-key", enabled: false },
    { id: "diff-viewer" },
    ...(Flag.OPENCODE_EXPERIMENTAL_SESSION_SWITCHER ? [{ id: "internal:session-switcher" as const }] : []),
  ]
}
