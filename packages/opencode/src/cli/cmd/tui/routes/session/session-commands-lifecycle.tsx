import type { PromptInfo } from "@tui/component/prompt/history"
import { DialogSessionRename } from "@tui/component/dialog-session-rename"
import { DialogConfirm } from "@tui/ui/dialog-confirm"
import { Clipboard } from "@tui/util/clipboard"
import type { createSessionRouteController } from "./session-controller"
import { DialogForkFromTimeline } from "./dialog-fork-from-timeline"
import { DialogTimeline } from "./dialog-timeline"

export function createSessionLifecycleCommands(controller: ReturnType<typeof createSessionRouteController>) {
  return [
    {
      title: controller.session()?.share?.url ? "Copy share link" : "Share session",
      value: "session.share",
      suggested: true,
      category: "Session",
      enabled: controller.sync.data.config.share !== "disabled",
      slash: { name: "share" },
      run: async () => {
        const copy = (url: string) =>
          Clipboard.copy(url)
            .then(() => controller.toast.show({ message: "Share URL copied to clipboard!", variant: "success" }))
            .catch(() => controller.toast.show({ message: "Failed to copy URL to clipboard", variant: "error" }))
        const url = controller.session()?.share?.url
        if (url) {
          await copy(url)
          controller.dialog.clear()
          return
        }
        if (!controller.kv.get("share_consent", false)) {
          const confirmed = await DialogConfirm.show(
            controller.dialog,
            "Share Session",
            "Are you sure you want to share it?",
          )
          if (confirmed !== true) return
          controller.kv.set("share_consent", true)
        }
        await controller.sdk.client.session
          .share({ sessionID: controller.route.sessionID })
          .then((result) => copy(result.data!.share!.url))
          .catch((error) =>
            controller.toast.show({
              message: error instanceof Error ? error.message : "Failed to share session",
              variant: "error",
            }),
          )
        controller.dialog.clear()
      },
    },
    {
      title: "Rename session",
      value: "session.rename",
      category: "Session",
      slash: { name: "rename" },
      run: () => controller.dialog.replace(() => <DialogSessionRename session={controller.route.sessionID} />),
    },
    {
      title: "Jump to message",
      value: "session.timeline",
      category: "Session",
      slash: { name: "timeline" },
      run: () =>
        controller.dialog.replace(() => (
          <DialogTimeline
            onMove={(messageID) => moveToMessage(controller, messageID)}
            sessionID={controller.route.sessionID}
            setPrompt={(prompt) => controller.prompt()?.set(prompt)}
          />
        )),
    },
    {
      title: "Fork session",
      value: "session.fork",
      category: "Session",
      slash: { name: "fork" },
      run: () =>
        controller.dialog.replace(() => (
          <DialogForkFromTimeline
            onMove={(messageID) => (messageID ? moveToMessage(controller, messageID) : undefined)}
            sessionID={controller.route.sessionID}
          />
        )),
    },
    {
      title: "Compact session",
      value: "session.compact",
      category: "Session",
      slash: { name: "compact", aliases: ["summarize"] },
      run: () => {
        const model = controller.local.model.current()
        if (!model) {
          controller.toast.show({
            variant: "warning",
            message: "Connect a provider to summarize this session",
            duration: 3000,
          })
          return
        }
        void controller.sdk.client.session.summarize({
          sessionID: controller.route.sessionID,
          modelID: model.modelID,
          providerID: model.providerID,
        })
        controller.dialog.clear()
      },
    },
    {
      title: "Unshare session",
      value: "session.unshare",
      category: "Session",
      enabled: Boolean(controller.session()?.share?.url),
      slash: { name: "unshare" },
      run: async () => {
        await controller.sdk.client.session
          .unshare({ sessionID: controller.route.sessionID })
          .then(() => controller.toast.show({ message: "Session unshared successfully", variant: "success" }))
          .catch((error) =>
            controller.toast.show({
              message: error instanceof Error ? error.message : "Failed to unshare session",
              variant: "error",
            }),
          )
        controller.dialog.clear()
      },
    },
    {
      title: "Undo previous message",
      value: "session.undo",
      category: "Session",
      slash: { name: "undo" },
      run: async () => {
        if (controller.sync.data.session_status[controller.route.sessionID]?.type !== "idle") {
          controller.sync.session.setPendingPrompt(controller.route.sessionID, undefined)
          await controller.sdk.client.session.abort({ sessionID: controller.route.sessionID }).catch(() => {})
        }
        const revertID = controller.session()?.revert?.messageID
        const message = controller
          .messages()
          .findLast((item) => (!revertID || item.id < revertID) && item.role === "user")
        if (!message) return
        void controller.sdk.client.session
          .revert({ sessionID: controller.route.sessionID, messageID: message.id })
          .then(controller.toBottom)
        controller.prompt()?.set(
          (controller.sync.data.part[message.id] ?? []).reduce(
            (prompt, part) => {
              if (part.type === "text" && !part.synthetic) prompt.input += part.text
              if (part.type === "file") prompt.parts.push(part)
              return prompt
            },
            { input: "", parts: [] as PromptInfo["parts"] },
          ),
        )
        controller.dialog.clear()
      },
    },
    {
      title: "Redo",
      value: "session.redo",
      category: "Session",
      enabled: Boolean(controller.session()?.revert?.messageID),
      slash: { name: "redo" },
      run: () => {
        controller.dialog.clear()
        const messageID = controller.session()?.revert?.messageID
        if (!messageID) return
        const message = controller.messages().find((item) => item.role === "user" && item.id > messageID)
        if (!message) {
          void controller.sdk.client.session.unrevert({ sessionID: controller.route.sessionID })
          controller.prompt()?.set({ input: "", parts: [] })
          return
        }
        void controller.sdk.client.session.revert({ sessionID: controller.route.sessionID, messageID: message.id })
      },
    },
  ]
}

function moveToMessage(controller: ReturnType<typeof createSessionRouteController>, messageID: string) {
  const scroll = controller.scroll()
  const child = scroll.getChildren().find((item) => item.id === messageID)
  if (child) scroll.scrollBy(child.y - scroll.y - 1)
}
