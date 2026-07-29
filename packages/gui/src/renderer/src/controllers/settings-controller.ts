import { createEffect, createSignal } from "solid-js"
import type { createAppearanceController } from "./appearance-controller"
import type { createAuthoritativeStateController } from "./authoritative-state-controller"
import type { createDialogController } from "./dialog-controller"
import type { createTranscriptPreferences } from "./transcript-preferences"
import { authHeaders } from "../lib/store"
import { readBoolPreference, writeBoolPreference } from "../lib/app-preferences"
import {
  isPermissionMode,
  permissionModeOption,
  PERMISSION_MODE_OPTIONS,
  type PermissionMode,
} from "../lib/permission-mode"

const ATTENTION_NOTIFICATIONS_KEY = "opencodex.gui.notifications.attention"

export function createSettingsController(input: {
  appearance: ReturnType<typeof createAppearanceController>
  authoritative: ReturnType<typeof createAuthoritativeStateController>
  dialogs: ReturnType<typeof createDialogController>
  transcript: ReturnType<typeof createTranscriptPreferences>
  alert: (message: string) => void
}) {
  const [attentionNotifications, setAttentionNotificationsSignal] = createSignal(
    readBoolPreference(ATTENTION_NOTIFICATIONS_KEY, true),
  )
  const [permissionMode, setPermissionMode] = createSignal<PermissionMode>()
  const [savingPermissionMode, setSavingPermissionMode] = createSignal(false)
  const [permissionModeError, setPermissionModeError] = createSignal<string>()
  let permissionModeRevision: string | undefined
  let loadedClient: ReturnType<typeof input.authoritative.client>
  let loadedCapabilitiesRevision: string | undefined

  createEffect(() => {
    const gui = input.authoritative.client()
    const revision = input.authoritative.state()?.capabilities?.revision
    if (!gui || (gui === loadedClient && revision === loadedCapabilitiesRevision)) return
    loadedClient = gui
    loadedCapabilitiesRevision = revision
    void loadPermissionMode(gui)
  })

  async function loadPermissionMode(gui: NonNullable<ReturnType<typeof input.authoritative.client>>) {
    try {
      const result = await gui.client.opencodex.settings.get({ headers: authHeaders(gui), throwOnError: true })
      permissionModeRevision = result.data?.revision
      const mode = result.data?.permission_mode
      if (isPermissionMode(mode)) {
        setPermissionMode(mode)
        return
      }
      setPermissionMode("configured")
      const selected = await input.dialogs.askChoice({
        title: "Choose permission mode",
        message: "Decide how closely OpenCodeX should supervise agent actions. You can change this later in Settings.",
        options: PERMISSION_MODE_OPTIONS.map((option) => ({
          value: option.id,
          title: option.label,
          description: option.description,
          meta: option.meta,
        })),
      })
      if (isPermissionMode(selected)) await changePermissionMode(selected)
    } catch (cause) {
      setPermissionModeError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  async function changePermissionMode(mode: PermissionMode) {
    const gui = input.authoritative.client()
    if (!gui || savingPermissionMode()) return
    if (!permissionModeRevision) {
      await loadPermissionMode(gui)
      return
    }
    if (
      mode === "yolo" &&
      !(await input.dialogs.confirm({
        title: "Enable YOLO mode?",
        message:
          "YOLO mode allows every agent action, including commands, file changes, external paths, and browser control that policy would normally block.",
        confirm: "Enable YOLO",
      }))
    )
      return

    setSavingPermissionMode(true)
    setPermissionModeError(undefined)
    try {
      const result = await gui.client.opencodex.settings.update(
        { opencodeXSettingsUpdateInput: { permission_mode: mode, expectedRevision: permissionModeRevision } },
        { headers: authHeaders(gui), throwOnError: true },
      )
      permissionModeRevision = result.data?.revision ?? permissionModeRevision
      setPermissionMode(mode)
    } catch (cause) {
      await loadPermissionMode(gui)
      const message = cause instanceof Error ? cause.message : String(cause)
      setPermissionModeError(message)
      input.alert(`Failed to update permission mode: ${message}`)
    } finally {
      setSavingPermissionMode(false)
    }
  }

  function setAttentionNotifications(value: boolean) {
    setAttentionNotificationsSignal(value)
    writeBoolPreference(ATTENTION_NOTIFICATIONS_KEY, value)
  }

  return {
    themeMode: input.appearance.themeMode,
    setThemeMode: input.appearance.setThemeMode,
    attentionNotifications,
    setAttentionNotifications,
    lifecycle: () => input.authoritative.state()?.lifecycle,
    retry: input.authoritative.retry,
    permissionMode,
    permissionModeOption: () => permissionModeOption(permissionMode()),
    permissionModeOptions: PERMISSION_MODE_OPTIONS,
    permissionModeError,
    savingPermissionMode,
    changePermissionMode,
    concealCodeBlocks: input.transcript.concealTranscriptCodeBlocks,
    setConcealCodeBlocks: input.transcript.setConcealTranscriptCodeBlocks,
    showTimestamps: input.transcript.showTranscriptTimestamps,
    setShowTimestamps: input.transcript.setShowTranscriptTimestamps,
    showThinking: input.transcript.showTranscriptThinking,
    setShowThinking: input.transcript.setShowTranscriptThinking,
    showToolDetails: input.transcript.showTranscriptToolDetails,
    setShowToolDetails: input.transcript.setShowTranscriptToolDetails,
    showScrollbar: input.transcript.showTranscriptScrollbar,
    setShowScrollbar: input.transcript.setShowTranscriptScrollbar,
    showGenericToolOutput: input.transcript.showTranscriptGenericToolOutput,
    setShowGenericToolOutput: input.transcript.setShowTranscriptGenericToolOutput,
  }
}
