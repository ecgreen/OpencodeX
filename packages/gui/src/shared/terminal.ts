export type TerminalLaunchProfile =
  | { kind: "shell" }
  | { kind: "claude-login" }
  | {
      kind: "claude-code"
      mode: "new" | "resume"
      resumeID: string
      name?: string
      installationID: string
    }

export type TerminalCreateInput = {
  id: string
  cwd?: string
  cols?: number
  rows?: number
  profile?: TerminalLaunchProfile
}

export type TerminalFailureCode =
  | "invalid-request"
  | "invalid-directory"
  | "missing-cli"
  | "wrong-device"
  | "duplicate-window"
  | "resource-limit"
  | "error"

export type TerminalResult = {
  ok: boolean
  code?: TerminalFailureCode
  message?: string
  pid?: number
}

export type ClaudeCodeStatus = {
  available: boolean
  executable?: string
  version?: string
  message?: string
}

export type ClaudeAuthStatus = {
  state: "signed-in" | "signed-out" | "unknown"
  authMethod?: string
  message?: string
}

export const CLAUDE_MISSING_MESSAGE =
  "Claude Code was not found. Install it from code.claude.com/docs/en/installation, then check again."
