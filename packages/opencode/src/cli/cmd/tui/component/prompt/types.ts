import type { JSX } from "@opentui/solid"
import type { Session } from "@opencode-ai/sdk/v2"
import type { PromptInfo } from "./history"

export type PromptProps = {
  sessionID?: string
  visible?: boolean
  disabled?: boolean
  useSessionContext?: boolean
  createSession?: (input: {
    workspaceID?: string
    agent: string
    model: { providerID: string; id: string; variant?: string }
  }) => Promise<Session | undefined>
  onSessionCreated?: (session: Session) => void | Promise<void>
  stayOnSessionCreated?: boolean
  onCustomSubmit?: (prompt: PromptInfo) => boolean | void | Promise<boolean | void>
  onSubmit?: () => void
  ref?: (ref: PromptRef | undefined) => void
  hint?: JSX.Element
  right?: JSX.Element
  targetLabel?: string
  showPlaceholder?: boolean
  draftKey?: string
  placeholders?: {
    normal?: string[]
    shell?: string[]
  }
}

export type PromptRef = {
  focused: boolean
  current: PromptInfo
  set(prompt: PromptInfo): void
  reset(): void
  blur(): void
  focus(): void
  submit(): void
  cycleAgent?(direction: 1 | -1): void
  cycleVariant?(): void
}

export type PromptState = {
  prompt: PromptInfo
  mode: "normal" | "shell"
  extmarkToPartIndex: Map<number, number>
  interrupt: number
  placeholder: number
}

export type OpencodeXPromptProject = {
  id: string
  name?: string
  project: {
    id: string
    name?: string
    worktree: string
  }
  sessions: { id: string }[]
}

export type OpencodeXPromptSwarm = {
  id: string
  title: string
  synthesisSessionID?: string
  runs?: {
    id: string
    orchestratorSessionID?: string
    resultSessionID?: string
    synthesisSessionID?: string
    timeCreated?: number
    timeUpdated?: number
  }[]
}

export type OpencodeXSwarmExecutionMode = "build" | "plan"
