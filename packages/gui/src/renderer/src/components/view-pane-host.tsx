import type { Agent, PermissionRequest, Provider, QuestionAnswer, QuestionRequest, Session } from "@opencode-ai/sdk/v2/client"
import type { SessionSlashCommand } from "../lib/session-slash-commands"
import type { GuiSnapshot, SessionData } from "../lib/store"
import { viewItemID, viewItemSession, type ViewItem } from "../lib/view-items"
import { ViewPane } from "./view-pane"

export function ViewPaneHost(props: {
  item: ViewItem
  snapshot?: GuiSnapshot
  data: Record<string, SessionData>
  emptyData: SessionData
  loading: Record<string, boolean>
  focusedSessionID: string
  composerFocusRequest: { sessionID: string; token: number }
  recentModels: string[]
  selectedAgent: string
  selectedModel: string
  selectedVariant: string
  providers: Provider[]
  agents: Agent[]
  setSelectedAgent: (sessionID: string, value: string) => void
  setSelectedModel: (sessionID: string, value: string) => void
  setSelectedVariant: (sessionID: string, value: string) => void
  focus: (sessionID: string, focusComposer: boolean) => void
  submit: (event: SubmitEvent, item: ViewItem, text: string) => void
  replyPermission: (request: PermissionRequest, reply: "once" | "always" | "reject") => void
  replyQuestion: (request: QuestionRequest, answers: QuestionAnswer[]) => void
  rejectQuestion: (request: QuestionRequest) => void
  abortSession: (sessionID: string) => void
  renameSession: (session: Session) => void
  moveSession: (session: Session) => void
  deleteSession: (session: Session) => void
  slashCommands: SessionSlashCommand[]
  showTimestamps: boolean
  showThinking: boolean
  loadOlderMessages: (sessionID: string, cursor: string) => Promise<void>
}) {
  const session = () => viewItemSession(props.item)
  const id = () => viewItemID(props.item)
  return (
    <ViewPane
      session={session()}
      pending={props.item.kind === "pending"}
      focused={() => props.focusedSessionID === id()}
      composerFocusToken={() => props.composerFocusRequest.sessionID === id() ? props.composerFocusRequest.token : 0}
      data={props.item.kind === "session" ? props.data[id()] ?? props.emptyData : props.emptyData}
      loading={props.loading[id()] === true}
      status={props.item.kind === "session" ? props.snapshot?.sessionStatus[id()]?.type ?? "idle" : "idle"}
      providers={props.providers}
      agents={props.agents}
      recentModels={props.recentModels}
      selectedAgent={props.selectedAgent}
      setSelectedAgent={(value) => props.setSelectedAgent(id(), value)}
      selectedModel={props.selectedModel}
      setSelectedModel={(value) => props.setSelectedModel(id(), value)}
      selectedVariant={props.selectedVariant}
      setSelectedVariant={(value) => props.setSelectedVariant(id(), value)}
      permissions={props.item.kind === "session" ? props.snapshot?.permissions.filter((request) => request.sessionID === id()) ?? [] : []}
      questions={props.item.kind === "session" ? props.snapshot?.questions.filter((request) => request.sessionID === id()) ?? [] : []}
      focus={(focusComposer) => props.focus(id(), focusComposer)}
      submit={(event, text) => props.submit(event, props.item, text)}
      replyPermission={props.replyPermission}
      replyQuestion={props.replyQuestion}
      rejectQuestion={props.rejectQuestion}
      abortSession={props.abortSession}
      renameSession={props.renameSession}
      moveSession={props.moveSession}
      deleteSession={props.deleteSession}
      slashCommands={props.slashCommands}
      showTimestamps={props.showTimestamps}
      showThinking={props.showThinking}
      loadOlderMessages={(cursor) => props.loadOlderMessages(id(), cursor)}
    />
  )
}
