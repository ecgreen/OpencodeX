import type { OpencodeXProject, QuestionAnswer, QuestionRequest, Session } from "@opencode-ai/sdk/v2/client"
import type { GuiClient } from "../lib/client"
import type { GuiSnapshot, SessionData } from "../lib/store"
import type { SessionSlashCommand } from "../lib/session-slash-commands"

export type WorkbenchPageProps = {
  gui?: GuiClient
  snapshot?: GuiSnapshot
  projects?: OpencodeXProject[]
  projectID?: string
  recentModels?: string[]
  selectedAgent?: string
  setSelectedAgent?: (value: string) => void
  selectedModel?: string
  setSelectedModel?: (value: string) => void
  selectedVariant?: string
  setSelectedVariant?: (value: string) => void
  rememberModel?: (value: string) => void
  refresh?: () => Promise<void>
  hydrateSession?: (sessionID: string, before?: string) => Promise<SessionData>
  replyPermission?: (request: GuiSnapshot["permissions"][number], reply: "once" | "always" | "reject") => void
  replyQuestion?: (request: QuestionRequest, answers: QuestionAnswer[]) => void
  rejectQuestion?: (request: QuestionRequest) => void
  abortSession?: (sessionID: string) => void
  renameSession?: (session: Session) => void
  moveSession?: (session: Session) => void
  deleteSession?: (session: Session) => void
  slashCommands?: (session: Session | undefined, data: SessionData, restorePrompt: (value: string) => void) => SessionSlashCommand[]
  concealCodeBlocks?: boolean
  showTimestamps?: boolean
  showThinking?: boolean
  showToolDetails?: boolean
  showScrollbar?: boolean
  showGenericToolOutput?: boolean
  toggleCodeConceal?: () => void
  toggleTimestamps?: () => void
  toggleThinking?: () => void
  toggleToolDetails?: () => void
  toggleScrollbar?: () => void
  toggleGenericToolOutput?: () => void
  sendToComposer?: (text: string) => void
  openDiff?: () => void
  openExternal?: (url: string) => void
  askText?: (input: { title: string; message?: string; value?: string; multiline?: boolean }) => Promise<string | undefined>
  confirm?: (input: { title: string; message: string; confirm?: string }) => Promise<boolean>
}
