import type { Accessor } from "solid-js"
import { createMemo } from "solid-js"
import type { KeyEvent, Renderable, TextareaRenderable } from "@opentui/core"
import type { CommandContext } from "@opentui/keymap"
import type { SessionStatus } from "@opencode-ai/sdk/v2"
import type { SetStoreFunction } from "solid-js/store"
import { useRenderer } from "@opentui/solid"
import { useDialog } from "@tui/ui/dialog"
import { useProject } from "@tui/context/project"
import { useSDK } from "@tui/context/sdk"
import { useToast } from "../../ui/toast"
import { OPENCODE_BASE_MODE, useBindings } from "../../keymap"
import { useTuiConfig } from "../../context/tui-config"
import { Clipboard } from "../../util/clipboard"
import { Editor } from "@tui/util/editor"
import { DialogSkill } from "../dialog-skill"
import { Flag } from "@opencode-ai/core/flag/flag"
import { refreshOpencodeXSidebar } from "../opencodex-sidebar"
import { errorMessage } from "@/util/error"
import type { PromptInfo } from "./history"
import type { createPromptEditorContext } from "./editor-context"
import type { createPromptOpencodeXContext } from "./opencodex"
import type { createPromptPasteController } from "./paste"
import type { PromptProps, PromptState } from "./types"
import type { createPromptWorkspaceController } from "./workspace"

export function installPromptCommands(input: {
  props: PromptProps
  state: PromptState
  setStore: SetStoreFunction<PromptState>
  textarea: () => TextareaRenderable
  autoVisible: () => boolean
  status: Accessor<SessionStatus>
  submit: () => Promise<boolean>
  clear: () => void
  paste: ReturnType<typeof createPromptPasteController>
  restoreExtmarks: (parts: PromptInfo["parts"]) => void
  editor: ReturnType<typeof createPromptEditorContext>
  opencodex: ReturnType<typeof createPromptOpencodeXContext>
  workspace: ReturnType<typeof createPromptWorkspaceController>
}) {
  const dialog = useDialog()
  const project = useProject()
  const renderer = useRenderer()
  const sdk = useSDK()
  const toast = useToast()
  const tuiConfig = useTuiConfig()
  const commands = createMemo(() => [
    {
      title: "Clear prompt",
      name: "prompt.clear",
      category: "Prompt",
      hidden: true,
      run: () => {
        input.clear()
        dialog.clear()
      },
    },
    {
      title: "Submit prompt",
      name: "prompt.submit",
      category: "Prompt",
      hidden: true,
      run: async () => {
        if (!input.textarea().focused || !(await input.submit())) return
        dialog.clear()
      },
    },
    {
      title: "Remove editor context",
      name: "prompt.editor_context.clear",
      category: "Prompt",
      enabled: Boolean(input.editor.context()),
      run: () => {
        input.editor.dismiss()
        dialog.clear()
      },
    },
    {
      title: "Paste",
      name: "prompt.paste",
      category: "Prompt",
      hidden: true,
      run: async (context: CommandContext<Renderable, KeyEvent>) => {
        context.event.preventDefault()
        context.event.stopPropagation()
        const content = await Clipboard.read()
        if (content?.mime.startsWith("image/")) {
          input.paste.attachment({ filename: "clipboard", mime: content.mime, content: content.data })
          return
        }
        if (content?.mime === "text/plain") await input.paste.inputText(content.data)
      },
    },
    {
      title: "Interrupt session",
      name: "session.interrupt",
      category: "Session",
      hidden: true,
      enabled: input.status().type !== "idle" || (input.opencodex.swarmID() !== undefined && !input.opencodex.deletedSwarmSession()),
      run: () => interrupt(input),
    },
    {
      title: "Open editor",
      category: "Session",
      name: "prompt.editor",
      slashName: "editor",
      run: openEditor,
    },
    {
      title: "Skills",
      name: "prompt.skills",
      category: "Prompt",
      slashName: "skills",
      run: () => dialog.replace(() => <DialogSkill onSelect={(skill) => {
        input.textarea().setText(`/${skill} `)
        input.setStore("prompt", { input: `/${skill} `, parts: [] })
        input.textarea().gotoBufferEnd()
      }} />),
    },
    {
      title: "Warp",
      desc: "Change the workspace for the session",
      name: "workspace.set",
      category: "Session",
      enabled: Flag.OPENCODE_EXPERIMENTAL_WORKSPACES,
      slashName: "warp",
      run: () => void input.workspace.open(),
    },
  ].map((command) => ({ namespace: "palette", ...command })))

  useBindings(() => ({ commands: commands() }))
  useBindings(() => ({
    mode: OPENCODE_BASE_MODE,
    bindings: tuiConfig.keybinds.gather("prompt.palette", [
      "prompt.submit",
      "prompt.editor",
      "prompt.editor_context.clear",
      "prompt.stash",
      "prompt.stash.pop",
      "prompt.stash.list",
      "session.interrupt",
      "workspace.set",
    ]),
  }))

  function interrupt(context: typeof input) {
    if (context.autoVisible() || !context.textarea().focused) return
    if (context.state.mode === "shell") {
      context.setStore("mode", "normal")
      return
    }
    const sessionID = context.props.sessionID
    if (!sessionID) return
    context.setStore("interrupt", context.state.interrupt + 1)
    setTimeout(() => context.setStore("interrupt", 0), 5000)
    if (context.state.interrupt < 2) {
      dialog.clear()
      return
    }
    const swarmID = context.opencodex.swarmID()
    if (swarmID && !context.opencodex.deletedSwarmSession()) {
      void sdk.request(`/experimental/opencodex/swarm/${swarmID}/cancel`, { method: "POST" })
        .then(() => {
          toast.show({ message: "Swarm cancellation requested.", variant: "info" })
          refreshOpencodeXSidebar()
        })
        .catch((error: Error) => toast.show({ message: `Cancelling swarm failed: ${errorMessage(error)}`, variant: "error" }))
    }
    void sdk.client.session.abort({ sessionID })
    context.setStore("interrupt", 0)
    dialog.clear()
  }

  async function openEditor() {
    dialog.clear()
    const text = input.state.prompt.parts
      .filter((part) => part.type === "text")
      .reduce((value, part) => part.source ? value.replace(part.source.text.value, part.text) : value, input.state.prompt.input)
    const parts = input.state.prompt.parts.filter((part) => part.type !== "text")
    const content = await Editor.open({
      value: text,
      renderer,
      cwd: (project.instance.path().worktree === "/" ? undefined : project.instance.path().worktree)
        || project.instance.directory()
        || process.cwd(),
    })
    if (!content) return
    input.textarea().setText(content)
    const updated = parts.flatMap((part) => {
      const virtualText = part.type === "file" ? part.source?.text?.value : part.type === "agent" ? part.source?.value : undefined
      if (!virtualText) return [part]
      const start = content.indexOf(virtualText)
      if (start === -1) return []
      if (part.type === "file" && part.source?.text) {
        return [{ ...part, source: { ...part.source, text: { ...part.source.text, start, end: start + virtualText.length } } }]
      }
      if (part.type === "agent" && part.source) {
        return [{ ...part, source: { ...part.source, start, end: start + virtualText.length } }]
      }
      return [part]
    })
    input.setStore("prompt", { input: content, parts: updated })
    input.restoreExtmarks(updated)
    input.textarea().cursorOffset = Bun.stringWidth(content)
  }
}
