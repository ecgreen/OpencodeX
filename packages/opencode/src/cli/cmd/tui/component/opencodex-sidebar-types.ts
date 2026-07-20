import type { Session } from "@opencode-ai/sdk/v2"
import type { ClientSessionOrderInput } from "@opencode-ai/sdk/v2/session-order"
import type { useRoute } from "@tui/context/route"
import type { useSDK } from "@tui/context/sdk"
import type { useSync } from "@tui/context/sync"
import type { useTheme } from "@tui/context/theme"
import type { useDialog } from "@tui/ui/dialog"
import type { DerivedStatus } from "./opencodex-session-status"

export type OpencodeXProjectInfo = {
  id: string
  name?: string
  project: { id: string; name?: string; worktree: string }
  folders: { path: string }[]
  sessions: Session[]
  sessionIDs: string[]
}

export type SidebarSessionOrderItem = ClientSessionOrderInput & { session: Session }
export type OpencodeXSwarmInfo = { id: string; title: string }
export type OpencodeXViewInfo = { id: string; title: string; sessionIDs: string[]; focusedSessionID?: string }
export type SessionManagerOptionValue = { type: "session"; id: string } | { type: "view"; id: string }
export type SidebarStatus = DerivedStatus | "review_ready" | "unviewed"
export type OpencodeXProjectValidation = { valid: boolean; folders: { input: string; path: string; valid: boolean; message?: string }[] }

export type OpencodeXDialogContext = {
  sdk: ReturnType<typeof useSDK>
  dialog: ReturnType<typeof useDialog>
  theme: ReturnType<typeof useTheme>["theme"]
  route?: ReturnType<typeof useRoute>
  sync?: ReturnType<typeof useSync>
  refetch?: () => void
}

export type SidebarRow = {
  id: string
  activate: () => void
  collapse?: () => void
  expand?: () => void
  keepFocus?: boolean
  parentID?: string
}
