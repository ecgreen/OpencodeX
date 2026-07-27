import semver from "semver"
import { onCleanup } from "solid-js"
import { FormatError, FormatUnknownError } from "@/cli/error"
import type { createTuiAppController } from "./app-controller"
import { TuiEvent } from "./event"
import { DialogAlert } from "./ui/dialog-alert"
import { DialogConfirm } from "./ui/dialog-confirm"

export function registerTuiAppEvents(controller: ReturnType<typeof createTuiAppController>) {
  const cleanup = [
    controller.event.on(TuiEvent.CommandExecute.type, (event) => {
      controller.keymap.dispatchCommand(event.properties.command)
    }),
    controller.event.on(TuiEvent.ToastShow.type, (event) => {
      controller.toast.show(event.properties)
    }),
    controller.event.on(TuiEvent.SessionSelect.type, (event) => {
      controller.route.navigate({ type: "session", sessionID: event.properties.sessionID })
    }),
    controller.event.on("session.deleted", (event) => {
      if (controller.route.data.type !== "session" || controller.route.data.sessionID !== event.properties.info.id) return
      controller.route.navigate({ type: "home" })
      controller.toast.show({ variant: "info", message: "The current session was deleted" })
    }),
    controller.event.on("session.error", (event) => {
      if (event.properties.error && typeof event.properties.error === "object" && event.properties.error.name === "MessageAbortedError") return
      controller.toast.show({ variant: "error", message: errorMessage(event.properties.error), duration: 5000 })
    }),
    controller.event.on("installation.update-available", async (event) => {
      const version = event.properties.version
      const skipped = controller.kv.get("skipped_version")
      if (skipped && !semver.gt(version, skipped)) return
      const choice = await DialogConfirm.show(
        controller.dialog,
        "Update Available",
        `A new release v${version} is available. Would you like to update now?`,
        "skip",
      )
      if (choice === false) {
        controller.kv.set("skipped_version", version)
        return
      }
      if (choice !== true) return
      controller.toast.show({ variant: "info", message: `Updating to v${version}...`, duration: 30000 })
      const result = await controller.sdk.client.global.upgrade({ target: version })
      if (result.error || !result.data?.success) {
        controller.toast.show({ variant: "error", title: "Update Failed", message: "Update failed", duration: 10000 })
        return
      }
      await DialogAlert.show(
        controller.dialog,
        "Update Complete",
        `Successfully updated to OpenCode v${result.data.version}. Please restart the application.`,
      )
      void controller.exit()
    }),
  ]
  onCleanup(() => cleanup.forEach((unsubscribe) => unsubscribe()))
}

function errorMessage(error: unknown) {
  const formatted = FormatError(error)
  if (formatted !== undefined) return formatted
  if (
    typeof error === "object" &&
    error !== null &&
    "data" in error &&
    typeof error.data === "object" &&
    error.data !== null &&
    "message" in error.data &&
    typeof error.data.message === "string"
  ) return error.data.message
  return FormatUnknownError(error)
}
