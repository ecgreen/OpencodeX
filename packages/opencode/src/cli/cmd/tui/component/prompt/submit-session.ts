import type { EditorSelection } from "@tui/context/editor"
import type { useSDK } from "@tui/context/sdk"
import type { useSync } from "@tui/context/sync"
import { MessageID, PartID } from "@/session/schema"
import { errorMessage } from "@/util/error"
import type { PromptInfo } from "./history"
import { formatEditorContext, opencodeXSwarmModeInstructions } from "./helpers"
import type { OpencodeXSwarmExecutionMode, PromptProps } from "./types"

type ModelSelection = { providerID: string; modelID: string }

export async function createPromptSession(input: {
  sdk: ReturnType<typeof useSDK>
  props: PromptProps
  workspaceID?: string
  pendingProject?: { projectID: string; directory: string }
  agent: string
  model: ModelSelection
  variant?: string
  titleSource: string
  showError: (message: string) => void
}) {
  const createInput = {
    workspaceID: input.workspaceID,
    agent: input.agent,
    model: { providerID: input.model.providerID, id: input.model.modelID, variant: input.variant },
  }
  const result = input.props.createSession
    ? await input.props.createSession(createInput)
        .then((session) => ({ data: session, error: undefined }))
        .catch((error: Error) => ({ data: undefined, error }))
    : input.pendingProject
      ? await input.sdk
          .request<Awaited<ReturnType<NonNullable<PromptProps["createSession"]>>>>("/experimental/opencodex/session", {
            method: "POST",
            body: JSON.stringify({
              projectID: input.pendingProject.projectID,
              directory: input.pendingProject.directory,
              ...createInput,
            }),
          })
          .then((session) => ({ data: session, error: undefined }))
          .catch((error: Error) => ({ data: undefined, error }))
      : await input.sdk.client.session.create({
          workspace: input.workspaceID,
          agent: input.agent,
          model: createInput.model,
        })
  if (result.error || !result.data) {
    input.showError(input.pendingProject ? `Creating a project session failed: ${errorMessage(result.error ?? "no response")}` : "Creating a session failed. Open console for more details.")
    return
  }

  await input.props.onSessionCreated?.(result.data)
  if (result.data.title.startsWith("New session - ")) {
    const title = input.titleSource.length <= 40 ? input.titleSource : input.titleSource.slice(0, 40).trimEnd()
    if (title) void input.sdk.client.session.update({ sessionID: result.data.id, title }).catch(() => undefined)
  }
  return result.data
}

export function isPromptSessionCommand(sync: ReturnType<typeof useSync>, mode: PromptInfo["mode"], text: string) {
  if (mode === "shell" || !text.trimStart().startsWith("/")) return false
  const command = text.trimStart().split("\n")[0]?.split(" ")[0]?.slice(1)
  return !!command && sync.data.command.some((item) => item.name === command)
}

export function sendPromptToSession(input: {
  sdk: ReturnType<typeof useSDK>
  sync: ReturnType<typeof useSync>
  sessionID: string
  agent: string
  model: ModelSelection
  variant?: string
  mode: "normal" | "shell"
  text: string
  parts: PromptInfo["parts"]
  editorSelection?: EditorSelection
  editorSelectionPending: boolean
  swarmMode?: OpencodeXSwarmExecutionMode
}) {
  const messageID = MessageID.ascending()
  const files = input.parts.filter((part) => part.type !== "text")
  const editorParts = input.editorSelection && input.editorSelectionPending
    ? [{
        id: PartID.ascending(),
        type: "text" as const,
        text: formatEditorContext(input.editorSelection),
        synthetic: true,
        metadata: {
          kind: "editor_context",
          source: input.editorSelection.source ?? "editor",
          filePath: input.editorSelection.filePath,
          ranges: input.editorSelection.ranges,
        },
      }]
    : []
  const swarmParts = input.swarmMode
    ? [{
        id: PartID.ascending(),
        type: "text" as const,
        text: opencodeXSwarmModeInstructions(input.swarmMode),
        synthetic: true,
        metadata: { kind: "opencodex_swarm_execution_mode", mode: input.swarmMode },
      }]
    : []

  if (input.mode === "shell") {
    void input.sdk.client.session.shell({
      sessionID: input.sessionID,
      agent: input.agent,
      model: input.model,
      command: input.text,
    })
    return { editorContextSent: false }
  }
  if (isPromptSessionCommand(input.sync, input.mode, input.text)) {
    const firstLineEnd = input.text.indexOf("\n")
    const firstLine = firstLineEnd === -1 ? input.text : input.text.slice(0, firstLineEnd)
    const [command, ...firstLineArgs] = firstLine.split(" ")
    const rest = firstLineEnd === -1 ? "" : input.text.slice(firstLineEnd + 1)
    void input.sdk.client.session.command({
      sessionID: input.sessionID,
      command: command.slice(1),
      arguments: firstLineArgs.join(" ") + (rest ? "\n" + rest : ""),
      agent: input.agent,
      model: `${input.model.providerID}/${input.model.modelID}`,
      messageID,
      variant: input.variant,
      parts: files.filter((part) => part.type === "file").map((part) => ({ id: PartID.ascending(), ...part })),
    })
    return { editorContextSent: false }
  }
  input.sdk.client.session
    .prompt({
      sessionID: input.sessionID,
      ...input.model,
      messageID,
      agent: input.agent,
      model: input.model,
      variant: input.variant,
      parts: [
        ...swarmParts,
        ...editorParts,
        { id: PartID.ascending(), type: "text", text: input.text },
        ...files.map((part) => ({ id: PartID.ascending(), ...part })),
      ],
    })
    .catch(() => undefined)
  return { editorContextSent: editorParts.length > 0 }
}
