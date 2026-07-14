import type { TextareaRenderable } from "@opentui/core"
import type { SetStoreFunction } from "solid-js/store"
import { unwrap } from "solid-js/store"
import { useDialog } from "@tui/ui/dialog"
import { useProject } from "@tui/context/project"
import { useRoute } from "@tui/context/route"
import { useSDK } from "@tui/context/sdk"
import { useSync } from "@tui/context/sync"
import { useToast } from "../../ui/toast"
import { useExit } from "../../context/exit"
import { useCommandSlashes, useOpencodeKeymap } from "../../keymap"
import { DialogProvider } from "../dialog-provider"
import { DialogWorkspaceUnavailable } from "../dialog-workspace-unavailable"
import { getPendingOpencodeXProjectSession, setPendingOpencodeXProjectSession, setPendingOpencodeXSwarmTask } from "../opencodex-session-state"
import { refreshOpencodeXSidebar } from "../opencodex-sidebar"
import { errorMessage } from "@/util/error"
import { usePromptDrafts } from "./drafts"
import { expandPromptText } from "./extmarks"
import {
  latestSwarmSessionID,
  matchOpencodeXSwarm,
  opencodeXSwarmExecutionMode,
  promptSlash,
} from "./helpers"
import { usePromptHistory } from "./history"
import type { createPromptEditorContext } from "./editor-context"
import type { createPromptOpencodeXContext } from "./opencodex"
import type { createPromptSessionContext } from "./session-context"
import { createPromptSession, isPromptSessionCommand, sendPromptToSession } from "./submit-session"
import type { OpencodeXPromptSwarm, PromptProps, PromptState } from "./types"
import type { createPromptWorkspaceController } from "./workspace"

export function createPromptSubmit(input: {
  props: PromptProps
  textarea: () => TextareaRenderable
  state: PromptState
  setStore: SetStoreFunction<PromptState>
  autoVisible: () => boolean
  promptPartTypeID: () => number
  syncExtmarks: () => void
  clear: () => void
  draftKey: () => string
  editor: ReturnType<typeof createPromptEditorContext>
  opencodex: ReturnType<typeof createPromptOpencodeXContext>
  session: ReturnType<typeof createPromptSessionContext>
  workspace: ReturnType<typeof createPromptWorkspaceController>
}) {
  const dialog = useDialog()
  const drafts = usePromptDrafts()
  const exit = useExit()
  const history = usePromptHistory()
  const keymap = useOpencodeKeymap()
  const project = useProject()
  const route = useRoute()
  const sdk = useSDK()
  const slashes = useCommandSlashes()
  const sync = useSync()
  const toast = useToast()
  let submitting = false

  async function submit() {
    if (submitting) return false
    submitting = true
    return submitInner().finally(() => {
      submitting = false
    })
  }

  async function submitInner() {
    input.workspace.clearNotice()
    const textarea = input.textarea()
    if (!textarea.isDestroyed && textarea.plainText !== input.state.prompt.input) {
      input.setStore("prompt", "input", textarea.plainText)
      input.syncExtmarks()
    }
    if (input.props.disabled || input.workspace.creating() || input.autoVisible() || !input.state.prompt.input) return false
    const trimmed = input.state.prompt.input.trim()
    if (["exit", "quit", ":q"].includes(trimmed)) {
      void exit()
      return true
    }
    const opencodex = await submitOpencodeX(trimmed)
    if (opencodex !== undefined) return opencodex
    const paletteSlash = slashes().find(
      (entry) => entry.display === trimmed || (entry.aliases ?? []).some((alias) => alias === trimmed),
    )
    if (paletteSlash) {
      paletteSlash.onSelect()
      input.clear()
      textarea.clear()
      return true
    }
    if (input.props.onCustomSubmit) return submitCustom()

    const agent = input.session.effectiveAgent()
    if (!agent) return false
    const model = input.session.model()
    if (!model) {
      toast.show({ variant: "warning", message: "Connect a provider to send prompts", duration: 3000 })
      if (sync.data.provider.length === 0) dialog.replace(() => <DialogProvider />)
      return false
    }
    const workspaceSession = input.props.sessionID ? sync.session.get(input.props.sessionID) : undefined
    const workspaceID = workspaceSession?.workspaceID
    if (input.props.sessionID && workspaceID && (project.workspace.status(workspaceID) ?? "error") !== "connected") {
      dialog.replace(() => <DialogWorkspaceUnavailable onRestore={() => {
        void input.workspace.open()
        return false
      }} />)
      return false
    }

    const variant = input.session.variant()
    const sessionID = input.props.sessionID ?? (await createSession(agent.name, model, variant))
    if (!sessionID) return true
    const text = expandPromptText(textarea, input.state, input.promptPartTypeID())
    if (input.opencodex.deletedSwarmSession() && !isPromptSessionCommand(sync, input.state.mode, text)) {
      toast.show({ message: "This swarm was deleted. The session is read-only; slash commands still work.", variant: "warning" })
      return false
    }
    const result = sendPromptToSession({
      sdk,
      sync,
      sessionID,
      agent: agent.name,
      model,
      variant,
      mode: input.state.mode,
      text,
      parts: input.state.prompt.parts,
      editorSelection: input.editor.context(),
      editorSelectionPending: input.editor.labelState() === "pending",
      swarmMode: input.opencodex.swarmID() === undefined ? undefined : opencodeXSwarmExecutionMode(agent.name),
    })
    if (result.editorContextSent) input.editor.editor.markSelectionSent()
    const currentMode = input.state.mode
    finish({ ...input.state.prompt, mode: currentMode }, true)
    if (!input.props.sessionID && !input.props.stayOnSessionCreated) {
      if (result.editorContextSent) input.editor.editor.preserveSelectionFromNewSession()
      setTimeout(() => route.navigate({ type: "session", sessionID }), 50)
    }
    return true
  }

  async function submitOpencodeX(trimmed: string) {
    const slash = promptSlash(trimmed)
    if (slash?.name === "swarm" || slash?.name === "open-swarm") {
      if (slash.name === "swarm" && input.session.startedSwarmSession()) {
        toast.show({ message: "Started swarm sessions cannot switch model or swarm.", variant: "warning", duration: 3000 })
        return false
      }
      if (!slash.arguments.trim()) {
        keymap.dispatchCommand(slash.name === "swarm" ? "opencodex.swarm.task" : "opencodex.swarm.open")
        input.clear()
        input.textarea().clear()
        return true
      }
      const swarms = input.opencodex.swarms() ?? (await loadSwarms())
      const swarm = swarms ? matchOpencodeXSwarm(swarms, slash.arguments) : undefined
      if (!swarm) {
        toast.show({ message: `No swarm matched "${slash.arguments}".`, variant: "warning" })
        return false
      }
      input.clear()
      input.textarea().clear()
      if (slash.name === "open-swarm") {
        route.navigate({ type: "opencodex-swarms", swarmID: swarm.id })
        return true
      }
      setPendingOpencodeXProjectSession(undefined)
      setPendingOpencodeXSwarmTask({ swarmID: swarm.id, title: swarm.title })
      route.navigate({ type: "home" })
      return true
    }

    const pending = input.opencodex.pendingSwarmTask()
    if (input.props.sessionID || !pending) return undefined
    const swarm = await sdk
      .request<OpencodeXPromptSwarm>(`/experimental/opencodex/swarm/${pending.swarmID}/task`, {
        method: "POST",
        body: JSON.stringify({
          prompt: trimmed,
          agent: input.session.effectiveAgent()?.name,
          mode: opencodeXSwarmExecutionMode(input.session.effectiveAgent()?.name),
          variant: input.session.variant(),
        }),
      })
      .catch((error: Error) => {
        toast.show({ message: `Assigning swarm task failed: ${errorMessage(error)}`, variant: "error" })
      })
    if (!swarm) return true
    const sessionID = latestSwarmSessionID(swarm)
    finish(unwrap(input.state.prompt), false)
    setPendingOpencodeXSwarmTask(undefined)
    refreshOpencodeXSidebar()
    if (sessionID) route.navigate({ type: "session", sessionID })
    return true
  }

  async function loadSwarms() {
    return sdk.request<OpencodeXPromptSwarm[]>("/experimental/opencodex/swarm").catch((error: Error) => {
      toast.show({ message: `Loading swarms failed: ${errorMessage(error)}`, variant: "error" })
    })
  }

  async function submitCustom() {
    const submitted = {
      ...unwrap(input.state.prompt),
      input: expandPromptText(input.textarea(), input.state, input.promptPartTypeID()),
      mode: input.state.mode,
    }
    if ((await input.props.onCustomSubmit?.(submitted)) === false) return false
    finish(submitted, true)
    return true
  }

  async function createSession(agent: string, model: { providerID: string; modelID: string }, variant?: string) {
    const selected = input.workspace.selection()
    const workspaceID = selected?.type === "existing" ? selected.workspaceID : undefined
    const pending = getPendingOpencodeXProjectSession()
    const session = await createPromptSession({
      sdk,
      props: input.props,
      workspaceID,
      pendingProject: pending,
      agent,
      model,
      variant,
      titleSource: input.state.prompt.input.trim().split(/\r?\n/)[0]?.trimEnd() ?? "",
      showError: (message) => toast.show({ message, variant: "error" }),
    })
    if (!session) return
    if (pending) {
      setPendingOpencodeXProjectSession(undefined)
      refreshOpencodeXSidebar()
    }
    return session.id
  }

  function finish(prompt: Parameters<typeof history.append>[1], notify: boolean) {
    history.append(input.draftKey(), prompt)
    input.textarea().extmarks.clear()
    input.setStore("prompt", { input: "", parts: [] })
    input.setStore("mode", "normal")
    input.setStore("extmarkToPartIndex", new Map())
    drafts.clear(input.draftKey())
    if (notify) input.props.onSubmit?.()
    input.textarea().clear()
  }

  return submit
}
