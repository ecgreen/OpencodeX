import { Effect } from "effect"
import { SessionLegacy } from "@opencode-ai/core/session/legacy"
import type { SessionSchema } from "@opencode-ai/core/session/schema"
import { Permission } from "@/permission"
import type { PermissionDecision } from "./claude-transport"
import { normalizeToolName } from "./claude-mapper"

/**
 * Bridges Claude Code's `canUseTool` callback onto OpencodeX's permission
 * system, so a mirrored session raises the same permission cards a native
 * session does. OpencodeX is the sole gate: Claude asks for everything and this
 * decides, honouring any "always allow" rules the user has already saved.
 */
/**
 * Takes the resolved permission service rather than reading it from context, so
 * the decision can be run from Claude's `canUseTool` callback on a captured
 * runtime without needing the ambient service layer.
 */
export const decideWith = (permission: Permission.Interface) =>
  Effect.fn("OpencodeXClaudeDriver.permission")(function* (input: {
  // Branded ids, so the driver's values pass straight through to `ask`.
  sessionID: typeof SessionSchema.ID.Type
  toolName: string
  toolInput: Record<string, unknown>
  messageID?: typeof SessionLegacy.MessageID.Type
  callID?: string
}) {
  const tool = normalizeToolName(input.toolName)
  const patterns = permissionPatterns(tool, input.toolInput)
  return yield* permission
    .ask({
      sessionID: input.sessionID,
      permission: tool,
      patterns,
      // The card shows the real Claude tool name alongside its full input.
      metadata: { ...input.toolInput, claudeTool: input.toolName },
      always: patterns,
      ...(input.messageID && input.callID
        ? { tool: { messageID: input.messageID, callID: input.callID } }
        : {}),
      ruleset: [],
    })
    .pipe(
      Effect.as<PermissionDecision>({ allow: true }),
      Effect.catchTag("PermissionRejectedError", () =>
        Effect.succeed<PermissionDecision>({ allow: false, message: "The user rejected this tool call." }),
      ),
      Effect.catchTag("PermissionDeniedError", () =>
        Effect.succeed<PermissionDecision>({ allow: false, message: "A permission rule denies this tool call." }),
      ),
      // A correction is a denial that carries instructions, so Claude can adapt
      // rather than simply retrying the same call.
      Effect.catchTag("PermissionCorrectedError", (error) =>
        Effect.succeed<PermissionDecision>({ allow: false, message: error.feedback }),
      ),
    )
})

/**
 * Patterns are what "always allow" remembers, so they must describe the action
 * rather than this one invocation. Unknown tools fall back to the tool name.
 */
export function permissionPatterns(tool: string, input: Record<string, unknown>): string[] {
  const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined)
  if (tool === "bash") {
    const command = text(input.command)
    return [command ? command.split(/\s+/)[0] : tool]
  }
  if (tool === "edit" || tool === "write" || tool === "read") {
    const file = text(input.file_path) ?? text(input.filePath) ?? text(input.notebook_path)
    return [file ?? tool]
  }
  if (tool === "webfetch") {
    const url = text(input.url)
    return [url ? hostOf(url) : tool]
  }
  if (tool === "websearch") return [text(input.query) ?? tool]
  return [tool]
}

function hostOf(url: string) {
  const match = url.match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i)
  return match ? match[1] : url
}

export * as ClaudePermission from "./claude-permission"
