import { stat } from "node:fs/promises"
import path from "node:path"
import type { ClaudeEvent } from "./claude-mapper"

/**
 * The process boundary for headless Claude Code. Everything SDK-specific lives
 * here so the driver only ever sees plain stream-json events; swapping to a raw
 * `claude -p --output-format stream-json` spawn means reimplementing this file
 * and nothing else.
 */

export type PermissionDecision = { allow: true; input?: Record<string, unknown> } | { allow: false; message: string }

export type TransportOptions = {
  cwd: string
  /**
   * A conversation id Claude itself issued on an earlier turn, to resume in
   * place. Omitted on the first turn: Claude mints the id, and resuming one it
   * never issued fails the whole turn with `error_during_execution`.
   */
  resumeID?: string
  executable?: string
  /**
   * A value from `supportedModels()` (`"sonnet"`, `"claude-fable-5[1m]"`, ...).
   * Omitted, or `"default"`, leaves the CLI on its configured model.
   */
  model?: string
  /** Reasoning effort, surfaced in OpencodeX as the model's variant chip. */
  effort?: string
  canUseTool: (toolName: string, input: Record<string, unknown>, toolUseID?: string) => Promise<PermissionDecision>
  signal?: AbortSignal
}

/** One row of the CLI's own model menu, as reported by `supportedModels()`. */
export type ClaudeModelInfo = {
  value: string
  displayName?: string
  description?: string
  resolvedModel?: string
  supportsEffort?: boolean
  supportedEffortLevels?: string[]
}

export const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"]

export type TransportTurn = {
  /** Ordered stream-json events for one prompt. */
  events: AsyncIterable<ClaudeEvent>
  interrupt: () => Promise<void>
}

export interface ClaudeTransport {
  /** Runs one prompt to completion, yielding events as they arrive. */
  run: (prompt: string, options: TransportOptions) => TransportTurn
}

export class ClaudeNotInstalledError extends Error {
  readonly _tag = "ClaudeNotInstalledError"
}

/** The CLI's own "leave it alone" row; never forwarded as an explicit model. */
export const DEFAULT_MODEL_VALUE = "default"

/**
 * Asks the installed CLI which models this account may use. The menu is
 * host-specific - context-window suffixes like `opus[1m]` depend on the plan -
 * so the catalog is discovered rather than hard-coded.
 *
 * The prompt stream intentionally never yields: the process starts, answers the
 * control request, and is torn down without running a completion.
 */
export async function listSupportedModels(input?: { executable?: string; cwd?: string; signal?: AbortSignal }) {
  const sdk = await import("@anthropic-ai/claude-agent-sdk").catch(() => undefined)
  if (!sdk?.query) throw new ClaudeNotInstalledError("The Claude Code SDK is unavailable.")
  const executable = input?.executable ?? (await resolveClaudeExecutable())
  if (!executable) throw new ClaudeNotInstalledError("Claude Code is not installed.")
  const controller = new AbortController()
  if (input?.signal) {
    if (input.signal.aborted) controller.abort()
    else input.signal.addEventListener("abort", () => controller.abort(), { once: true })
  }
  const running = sdk.query({
    prompt: idlePrompt(),
    options: {
      cwd: input?.cwd ?? process.cwd(),
      abortController: controller,
      pathToClaudeCodeExecutable: executable,
    },
  } as Parameters<typeof sdk.query>[0]) as unknown as {
    supportedModels?: () => Promise<ClaudeModelInfo[]>
    interrupt?: () => Promise<void>
  }
  try {
    return (await running.supportedModels?.()) ?? []
  } finally {
    controller.abort()
    await running.interrupt?.().catch(() => undefined)
  }
}

async function* idlePrompt(): AsyncGenerator<never> {
  await new Promise(() => undefined)
}

export function createSdkTransport(): ClaudeTransport {
  return {
    run(prompt, options) {
      const controller = new AbortController()
      if (options.signal) {
        if (options.signal.aborted) controller.abort()
        else options.signal.addEventListener("abort", () => controller.abort(), { once: true })
      }
      let query: { interrupt?: () => Promise<void> } | undefined

      async function* events(): AsyncIterable<ClaudeEvent> {
        const sdk = await import("@anthropic-ai/claude-agent-sdk").catch(() => undefined)
        if (!sdk?.query) throw new ClaudeNotInstalledError("The Claude Code SDK is unavailable.")
        const executable = options.executable ?? (await resolveClaudeExecutable())
        const running = sdk.query({
          prompt,
          options: {
            cwd: options.cwd,
            abortController: controller,
            // OpencodeX is the sole permission gate: Claude defers every tool
            // decision to canUseTool, which bridges to OpencodeX permission cards.
            permissionMode: "default",
            canUseTool: async (toolName, input, extra) => {
              const decision = await options.canUseTool(toolName, input, extra?.toolUseID)
              return decision.allow
                ? { behavior: "allow", updatedInput: decision.input ?? input }
                : { behavior: "deny", message: decision.message }
            },
            ...(options.resumeID ? { resume: options.resumeID } : {}),
            ...(executable ? { pathToClaudeCodeExecutable: executable } : {}),
            ...(options.model && options.model !== DEFAULT_MODEL_VALUE ? { model: options.model } : {}),
            ...(options.effort && EFFORT_LEVELS.includes(options.effort) ? { effort: options.effort } : {}),
          },
        } as Parameters<typeof sdk.query>[0])
        query = running as { interrupt?: () => Promise<void> }
        for await (const message of running) yield message as ClaudeEvent
      }

      return {
        events: events(),
        interrupt: async () => {
          controller.abort()
          await query?.interrupt?.().catch(() => undefined)
        },
      }
    },
  }
}

/**
 * Mirrors the GUI main-process resolver: only a real executable file counts,
 * and Windows resolves `claude.exe` because npm's shim cannot be spawned.
 */
export async function resolveClaudeExecutable(input?: { path?: string; home?: string; platform?: NodeJS.Platform }) {
  const platform = input?.platform ?? process.platform
  const names = platform === "win32" ? ["claude.exe"] : ["claude"]
  const home = input?.home ?? process.env.HOME ?? process.env.USERPROFILE
  const fromPath = (input?.path ?? process.env.PATH ?? "")
    .split(platform === "win32" ? ";" : ":")
    .filter(Boolean)
    .flatMap((directory) => names.map((name) => path.join(directory, name)))
  const native = home
    ? platform === "win32"
      ? [path.join(home, ".local", "bin", "claude.exe")]
      : [path.join(home, ".local", "bin", "claude"), "/usr/local/bin/claude", "/opt/homebrew/bin/claude"]
    : []
  for (const candidate of [...new Set([...fromPath, ...native])]) {
    const info = await stat(candidate).catch(() => undefined)
    if (!info?.isFile()) continue
    if (platform === "win32" || (info.mode & 0o111) !== 0) return candidate
  }
  return undefined
}

export * as ClaudeTransport from "./claude-transport"
