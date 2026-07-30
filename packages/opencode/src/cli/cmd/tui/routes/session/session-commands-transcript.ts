import path from "path"
import { Filesystem } from "@/util/filesystem"
import { DialogExportOptions } from "@tui/ui/dialog-export-options"
import { Clipboard } from "@tui/util/clipboard"
import { Editor } from "@tui/util/editor"
import { formatTranscript } from "@tui/util/transcript"
import type { createSessionRouteController } from "./session-controller"

export function createSessionTranscriptCommands(controller: ReturnType<typeof createSessionRouteController>) {
  return [
    {
      title: "Copy last assistant message",
      value: "messages.copy",
      category: "Session",
      run: () => {
        const revertID = controller.session()?.revert?.messageID
        const message = controller.messages().findLast((item) => item.role === "assistant" && (!revertID || item.id < revertID))
        if (!message) return commandError(controller, "No assistant messages found")
        const text = (controller.sync.data.part[message.id] ?? [])
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n")
          .trim()
        if (!text) return commandError(controller, "No text content found in last assistant message")
        Clipboard.copy(text)
          .then(() => controller.toast.show({ message: "Message copied to clipboard!", variant: "success" }))
          .catch(() => controller.toast.show({ message: "Failed to copy to clipboard", variant: "error" }))
        controller.dialog.clear()
      },
    },
    {
      title: "Copy session transcript",
      value: "session.copy",
      category: "Session",
      slash: { name: "copy" },
      run: () => transcript(controller, {
        thinking: controller.showThinking(),
        toolDetails: controller.showDetails(),
        assistantMetadata: controller.showAssistantMetadata(),
      })
        .then(Clipboard.copy)
        .then(() => controller.toast.show({ message: "Session transcript copied to clipboard!", variant: "success" }))
        .catch(() => controller.toast.show({ message: "Failed to copy session transcript", variant: "error" }))
        .finally(controller.dialog.clear),
    },
    {
      title: "Export session transcript",
      value: "session.export",
      category: "Session",
      slash: { name: "export" },
      run: () => exportTranscript(controller)
        .catch(() => controller.toast.show({ message: "Failed to export session", variant: "error" }))
        .finally(controller.dialog.clear),
    },
    {
      title: "Go to child session",
      value: "session.child.first",
      category: "Session",
      hidden: true,
      run: () => {
        controller.dialog.clear()
        controller.moveFirstChild()
      },
    },
    {
      title: "Go to parent session",
      value: "session.parent",
      category: "Session",
      hidden: true,
      enabled: Boolean(controller.session()?.parentID),
      run: controller.childSessionHandler(() => {
        const parentID = controller.session()?.parentID
        if (parentID) controller.navigate({ type: "session", sessionID: parentID })
        controller.dialog.clear()
      }),
    },
    {
      title: "Next child session",
      value: "session.child.next",
      category: "Session",
      hidden: true,
      enabled: Boolean(controller.session()?.parentID),
      run: controller.childSessionHandler(() => {
        controller.dialog.clear()
        controller.moveChild(1)
      }),
    },
    {
      title: "Previous child session",
      value: "session.child.previous",
      category: "Session",
      hidden: true,
      enabled: Boolean(controller.session()?.parentID),
      run: controller.childSessionHandler(() => {
        controller.dialog.clear()
        controller.moveChild(-1)
      }),
    },
  ]
}

function commandError(controller: ReturnType<typeof createSessionRouteController>, message: string) {
  controller.toast.show({ message, variant: "error" })
  controller.dialog.clear()
}

// The rendered transcript is a bounded window; an export has to cover the whole
// session. It reads the history straight from the server so the export never
// drags the full transcript back into resident state.
async function transcript(
  controller: ReturnType<typeof createSessionRouteController>,
  options: { thinking: boolean; toolDetails: boolean; assistantMetadata: boolean },
) {
  const session = controller.session()
  if (!session) throw new Error("Session not found")
  const messages = await controller.sync.session.transcriptMessages(session.id)
  return formatTranscript(session, messages, { ...options, providers: controller.sync.data.provider })
}

async function exportTranscript(controller: ReturnType<typeof createSessionRouteController>) {
  const session = controller.session()
  if (!session) return
  const options = await DialogExportOptions.show(
    controller.dialog,
    `session-${session.id.slice(0, 8)}.md`,
    controller.showThinking(),
    controller.showDetails(),
    controller.showAssistantMetadata(),
    false,
  )
  if (!options) return
  const content = await transcript(controller, options)
  if (options.openWithoutSaving) {
    await Editor.open({ value: content, renderer: controller.renderer, cwd: editorDirectory(controller) })
    return
  }
  const filename = options.filename.trim()
  const filePath = path.join(process.cwd(), filename)
  await Filesystem.write(filePath, content)
  const edited = await Editor.open({ value: content, renderer: controller.renderer, cwd: editorDirectory(controller) })
  if (edited !== undefined) await Filesystem.write(filePath, edited)
  controller.toast.show({ message: `Session exported to ${filename}`, variant: "success" })
}

function editorDirectory(controller: ReturnType<typeof createSessionRouteController>) {
  const worktree = controller.project.instance.path().worktree
  return (worktree === "/" ? undefined : worktree) || controller.project.instance.directory() || process.cwd()
}
