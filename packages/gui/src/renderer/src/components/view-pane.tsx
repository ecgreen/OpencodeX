import type { Agent, PermissionRequest, Provider, QuestionAnswer, QuestionRequest, Session } from "@opencode-ai/sdk/v2/client"
import type { SessionSlashCommand } from "../lib/session-slash-commands"
import type { SessionData } from "../lib/store"
import { SessionPage } from "./session-page"

export function ViewPane(props: {
  session: Session
  pending?: boolean
  focused: () => boolean
  composerFocusToken: () => number
  data: SessionData
  loading: boolean
  status: string
  providers: Provider[]
  agents: Agent[]
  recentModels: string[]
  selectedAgent: string
  setSelectedAgent: (value: string) => void
  selectedModel: string
  setSelectedModel: (value: string) => void
  selectedVariant: string
  setSelectedVariant: (value: string) => void
  permissions: PermissionRequest[]
  questions: QuestionRequest[]
  focus: (focusComposer: boolean) => void
  submit: (event: SubmitEvent, text: string) => void
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
  loadOlderMessages: (cursor: string) => Promise<void>
}) {
  const handlePointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || props.focused()) return
    props.focus(shouldAutoFocusViewComposer(event))
  }
  return (
    <article class="view-pane" classList={{ focused: props.focused() }} onPointerDown={handlePointerDown}>
      <SessionPage
        session={props.session}
        data={props.data}
        loading={props.loading}
        prompt=""
        setPrompt={() => undefined}
        providers={props.providers}
        agents={props.agents}
        selectedAgent={props.selectedAgent}
        setSelectedAgent={props.setSelectedAgent}
        selectedModel={props.selectedModel}
        recentModels={props.recentModels}
        setSelectedModel={props.setSelectedModel}
        selectedVariant={props.selectedVariant}
        setSelectedVariant={props.setSelectedVariant}
        submit={props.submit}
        permissions={props.permissions}
        questions={props.questions}
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
        status={props.status}
        pending={props.pending}
        composerFocusToken={props.composerFocusToken}
        loadOlderMessages={props.loadOlderMessages}
      />
    </article>
  )
}

function shouldAutoFocusViewComposer(event: PointerEvent) {
  const target = event.target
  if (!(target instanceof Element)) return true
  return !target.closest("button, input, textarea, select, a, summary, [contenteditable='true'], [role='button'], [role='option']")
}
