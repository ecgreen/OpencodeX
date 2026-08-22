import { Cause, Effect, Exit } from "effect"
import { EffectBridge } from "@/effect/bridge"

export type FailureReason = "cancelled" | "errored" | "empty-output" | "rejected"

export type Result = { ok: true; text: string } | { ok: false; reason: FailureReason }

export type Swarm = {
  roles: Array<{ name: string; description?: string }>
  /** `toolUseID` is the orchestrator's tool call id for this delegation. */
  run: (input: { role: string; prompt: string; toolUseID?: string }) => Effect.Effect<Result, unknown>
}

export function failureMessage(input: Extract<Result, { ok: false }>): string {
  const message =
    input.reason === "cancelled"
      ? "The delegated role was cancelled before it completed."
      : input.reason === "empty-output"
        ? "The delegated role completed without a usable report."
        : input.reason === "rejected"
          ? "The delegation request was rejected."
          : "The delegated role failed."
  return message
}

export function failure(reason: FailureReason): Extract<Result, { ok: false }> {
  return { ok: false, reason }
}

/** Bridges one SDK request signal to its delegate fiber without detaching work. */
export function capability(bridge: EffectBridge.Shape, delegate: Swarm) {
  return {
    roles: delegate.roles,
    run: (input: { role: string; prompt: string; toolUseID?: string; signal?: AbortSignal }) => {
      if (input.signal?.aborted) return Promise.resolve(failure("cancelled"))
      return bridge
        .promiseExit(
          delegate.run({
            role: input.role,
            prompt: input.prompt,
            ...(input.toolUseID ? { toolUseID: input.toolUseID } : {}),
          }),
          input.signal ? { signal: input.signal } : undefined,
        )
        .then((exit) => {
          if (Exit.isSuccess(exit)) return exit.value
          if (Cause.hasInterruptsOnly(exit.cause)) return failure("cancelled")
          return Promise.reject(Cause.squash(exit.cause))
        })
    },
  }
}

export * as ClaudeDelegate from "./claude-delegate"
