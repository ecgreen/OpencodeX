import { Effect } from "effect"

const handlers = new Set<() => Effect.Effect<void>>()

export function register(handler: () => Effect.Effect<void>) {
  handlers.add(handler)
  return () => handlers.delete(handler)
}

export const run = Effect.fn("SessionPromptRecovery.run")(function* () {
  yield* Effect.forEach(handlers, (handler) => handler(), { discard: true })
})

export * as SessionPromptRecovery from "./prompt-recovery"
