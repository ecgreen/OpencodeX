import type { GuiCapabilitiesSnapshot, GuiSnapshot } from "./store-types"
import { sameValue } from "./same-value"

export function reconcileGuiCapabilities(current: GuiSnapshot, next: GuiCapabilitiesSnapshot): GuiSnapshot {
  const merged = {
    ...current,
    providers: stableValue(current.providers, next.providers),
    connectedProviderIDs: stableValue(current.connectedProviderIDs, next.connectedProviderIDs),
    agents: stableValue(current.agents, next.agents),
    commands: stableValue(current.commands, next.commands),
    lsp: stableValue(current.lsp, next.lsp),
    mcp: stableValue(current.mcp, next.mcp),
    config: stableValue(current.config, next.config),
    mcpResources: stableValue(current.mcpResources, next.mcpResources),
    plugins: stableValue(current.plugins, next.plugins),
  }
  return current.providers === merged.providers &&
    current.connectedProviderIDs === merged.connectedProviderIDs &&
    current.agents === merged.agents &&
    current.commands === merged.commands &&
    current.lsp === merged.lsp &&
    current.mcp === merged.mcp &&
    current.config === merged.config &&
    current.mcpResources === merged.mcpResources &&
    current.plugins === merged.plugins
    ? current
    : merged
}

function stableValue<T>(current: T, next: T) {
  return sameValue(current, next) ? current : next
}
