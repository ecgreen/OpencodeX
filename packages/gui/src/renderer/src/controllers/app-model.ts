import type { createAppearanceController } from "./appearance-controller"
import type { createAuthoritativeStateController } from "./authoritative-state-controller"
import type { createCapabilityActionsController } from "./capability-actions-controller"
import type { createClaudeTerminalController } from "./claude-terminal-controller"
import type { createCommandController } from "./command-controller"
import type { createDialogController } from "./dialog-controller"
import type { createManagementActionsController } from "./management-actions-controller"
import type { createNavigationController } from "./navigation-controller"
import type { createNoticeController } from "./notice-controller"
import type { createOverlayState } from "./overlay-state"
import type { createPluginController } from "./plugin-controller"
import type { createRailController } from "./rail-controller"
import type { createSessionActionsController } from "./session-actions-controller"
import type { createSessionComposerController } from "./session-composer-controller"
import type { createSessionSelectionController } from "./session-selection-controller"
import type { createSessionSlashController } from "./session-slash-controller"
import type { createSessionState } from "./session-state"
import type { createSessionSwitcherController } from "./session-switcher-controller"
import type { createSettingsController } from "./settings-controller"
import type { createTranscriptPreferences } from "./transcript-preferences"
import type { createViewController } from "./view-controller"

export type GuiAppModel = {
  appearance: ReturnType<typeof createAppearanceController>
  authoritative: ReturnType<typeof createAuthoritativeStateController>
  capabilities: ReturnType<typeof createCapabilityActionsController>
  claudeTerminals: ReturnType<typeof createClaudeTerminalController>
  commands: ReturnType<typeof createCommandController>
  dialogs: ReturnType<typeof createDialogController>
  management: ReturnType<typeof createManagementActionsController>
  navigation: ReturnType<typeof createNavigationController>
  notices: ReturnType<typeof createNoticeController>
  overlays: ReturnType<typeof createOverlayState>
  plugins: ReturnType<typeof createPluginController>
  rail: ReturnType<typeof createRailController>
  sessionActions: ReturnType<typeof createSessionActionsController>
  sessionComposer: ReturnType<typeof createSessionComposerController>
  sessionSelection: ReturnType<typeof createSessionSelectionController>
  sessionSlash: ReturnType<typeof createSessionSlashController>
  sessionState: ReturnType<typeof createSessionState>
  sessionSwitcher: ReturnType<typeof createSessionSwitcherController>
  settings: ReturnType<typeof createSettingsController>
  transcriptPreferences: ReturnType<typeof createTranscriptPreferences>
  view: ReturnType<typeof createViewController>
}
