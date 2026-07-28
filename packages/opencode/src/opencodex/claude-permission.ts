import { createTwoFilesPatch } from "diff"
import { Effect } from "effect"
import { SessionLegacy } from "@opencode-ai/core/session/legacy"
import type { SessionSchema } from "@opencode-ai/core/session/schema"
import { Permission } from "@/permission"
import { Question } from "@/question"
import type { PermissionDecision } from "./claude-transport"
import { normalizeToolName } from "./claude-mapper"

/**
 * Bridges Claude Code's `canUseTool` callback onto OpencodeX's permission
 * system, so a mirrored session raises the same permission cards a native
 * session does. OpencodeX is the sole gate: Claude asks for everything and this
 * decides, honouring any "always allow" rules the user has already saved.
 *
 * `AskUserQuestion` is the one tool that is not a permission: Claude is asking
 * the user to pick an answer, so it routes to the Question service and the
 * collected answers travel back inside `updatedInput` - the contract the CLI
 * defines for its permission component (`AskUserQuestionInput.answers`).
 */
/**
 * Takes the resolved services rather than reading them from context, so the
 * decision can be run from Claude's `canUseTool` callback on a captured
 * runtime without needing the ambient service layer.
 */
export const decideWith = (permission: Permission.Interface, question: Question.Interface) =>
  Effect.fn("OpencodeXClaudeDriver.permission")(function* (input: {
  // Branded ids, so the driver's values pass straight through to `ask`.
  sessionID: typeof SessionSchema.ID.Type
  toolName: string
  toolInput: Record<string, unknown>
  messageID?: typeof SessionLegacy.MessageID.Type
  callID?: string
  /**
   * The agent ruleset merged with any session rules, resolved by the caller for
   * this turn. It carries the user's `permission_mode` (applied in `Agent.get`),
   * so it must be threaded through: passing an empty ruleset makes `evaluate`
   * fall back to its implicit "ask", which prompts for every tool call no matter
   * which mode the user picked.
   */
  ruleset: Permission.Ruleset
}) {
  const tool = normalizeToolName(input.toolName)

  if (tool === "question") {
    const questions = questionInfos(input.toolInput)
    if (questions) {
      return yield* question
        .ask({
          sessionID: input.sessionID,
          questions,
          ...(input.messageID && input.callID
            ? { tool: { messageID: input.messageID, callID: input.callID } }
            : {}),
        })
        .pipe(
          Effect.map(
            (answers): PermissionDecision => ({
              allow: true,
              input: withQuestionAnswers(input.toolInput, questions, answers),
            }),
          ),
          Effect.catchTag("QuestionRejectedError", () =>
            Effect.succeed<PermissionDecision>({
              allow: false,
              message: "The user dismissed this question without answering. Continue without this information, or proceed with your best judgment.",
            }),
          ),
        )
    }
  }

  const patterns = permissionPatterns(tool, input.toolInput)
  return yield* permission
    .ask({
      sessionID: input.sessionID,
      permission: tool,
      patterns,
      // The card shows the real Claude tool name alongside its full input.
      metadata: { ...permissionMetadata(tool, input.toolInput), claudeTool: input.toolName },
      always: patterns,
      ...(input.messageID && input.callID
        ? { tool: { messageID: input.messageID, callID: input.callID } }
        : {}),
      ruleset: input.ruleset,
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
 * Parses `AskUserQuestionInput.questions` into the Question service's shape.
 * Returns undefined when the input doesn't look like a question request, in
 * which case the caller falls back to an ordinary permission card rather than
 * silently swallowing the tool call.
 */
export function questionInfos(input: Record<string, unknown>): Question.Info[] | undefined {
  if (!Array.isArray(input.questions) || input.questions.length === 0) return undefined
  const parsed: Question.Info[] = []
  for (const raw of input.questions) {
    if (typeof raw !== "object" || raw === null) return undefined
    const item = raw as Record<string, unknown>
    if (typeof item.question !== "string" || !Array.isArray(item.options)) return undefined
    const options: Question.Option[] = []
    for (const option of item.options) {
      if (typeof option !== "object" || option === null) return undefined
      const entry = option as Record<string, unknown>
      if (typeof entry.label !== "string") return undefined
      options.push({ label: entry.label, description: typeof entry.description === "string" ? entry.description : "" })
    }
    parsed.push({
      question: item.question,
      header: typeof item.header === "string" ? item.header : "Question",
      options,
      // Claude calls it multiSelect; the CLI always offers an "Other" answer,
      // so custom input stays enabled on the OpencodeX card too.
      multiple: item.multiSelect === true,
      custom: true,
    })
  }
  return parsed
}

/**
 * Folds the user's selections back into the tool input the way the CLI's own
 * permission component does: `answers` keyed by the full question text, with
 * multi-selections joined into one string.
 */
export function withQuestionAnswers(
  input: Record<string, unknown>,
  questions: ReadonlyArray<Question.Info>,
  answers: ReadonlyArray<Question.Answer>,
): Record<string, unknown> {
  const byQuestion: Record<string, string> = {}
  questions.forEach((item, index) => {
    const answer = answers[index]
    if (!answer || answer.length === 0) return
    byQuestion[item.question] = answer.join(", ")
  })
  return { ...input, answers: byQuestion }
}

/**
 * Reshapes Claude's raw tool input into the metadata the permission cards read.
 * Native tools ask with `{ filepath, diff }` (see tool/edit.ts); Claude sends
 * `file_path` / `old_string` / `new_string`, so without this mapping the edit
 * card renders with no file name and no diff.
 */
export function permissionMetadata(tool: string, input: Record<string, unknown>): Record<string, unknown> {
  const text = (value: unknown) => (typeof value === "string" ? value : undefined)
  const file = text(input.file_path) ?? text(input.filePath) ?? text(input.notebook_path)
  if (tool === "edit" && file) {
    const before = text(input.old_string)
    const after = text(input.new_string)
    return {
      ...input,
      filepath: file,
      // The changed snippet only - the driver has no business reading the file
      // just to widen the context, and the card links the full path anyway.
      ...(before !== undefined && after !== undefined
        ? { diff: createTwoFilesPatch(file, file, before, after) }
        : {}),
    }
  }
  if (tool === "write" && file) {
    const content = text(input.content)
    return {
      ...input,
      filepath: file,
      ...(content !== undefined ? { diff: createTwoFilesPatch(file, file, "", content) } : {}),
    }
  }
  // The read card reads `filePath`; Claude spells it `file_path`.
  if (tool === "read" && file) return { ...input, filePath: file }
  return input
}

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
