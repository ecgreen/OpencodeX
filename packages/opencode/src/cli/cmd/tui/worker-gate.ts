/**
 * Serializes worker shutdown with in-flight RPC work (OpencodeX-l1v layer 2).
 *
 * The TUI worker's `shutdown()` used to call `disposeAllInstances()` no matter
 * what was mid-flight; a shutdown arriving while an instance create/bootstrap
 * RPC was still running killed the database mid-statement and surfaced as a
 * fatal "Failed to execute statement" through the RPC channel. The gate makes
 * that race impossible to hit:
 *
 * - every instance-touching RPC handler runs through `run()`, which tracks its
 *   settlement;
 * - `drain()` flips the gate closed (new work is rejected with
 *   {@link WorkerShuttingDownError} instead of racing disposal) and waits for
 *   the tracked work to settle, up to a cap so a hung handler cannot block
 *   shutdown forever.
 */
import { withTimeout } from "@/util/timeout"

export class WorkerShuttingDownError extends Error {
  constructor() {
    super("The worker is shutting down; the request was not started.")
    this.name = "WorkerShuttingDownError"
  }
}

export type WorkerGate = {
  /** True once drain() has been called; new run() calls reject from then on. */
  readonly draining: boolean
  /** Runs `work` and tracks it until it settles. Rejects fast once draining. */
  run<T>(work: () => Promise<T>): Promise<T>
  /**
   * Closes the gate and waits for in-flight work to settle. Resolves `true`
   * when everything settled, `false` when the timeout elapsed first (the
   * caller may proceed with disposal, but knows the work was abandoned).
   *
   * The default budget must stay inside the TUI main thread's own shutdown
   * timeout (5s in thread.ts, after which the worker is hard-terminated):
   * a drain that outlives it would mean disposal never runs at all, which is
   * exactly the unclean teardown the gate exists to prevent.
   */
  drain(timeoutMs?: number): Promise<boolean>
}

export function createWorkerGate(): WorkerGate {
  let draining = false
  const inflight = new Set<Promise<unknown>>()

  return {
    get draining() {
      return draining
    },
    run<T>(work: () => Promise<T>): Promise<T> {
      if (draining) return Promise.reject(new WorkerShuttingDownError())
      // `async` so a synchronous throw from `work` becomes a rejection that is
      // tracked and delivered like any other failure.
      const promise = (async () => work())()
      inflight.add(promise)
      const settle = () => {
        inflight.delete(promise)
      }
      // A separate observation chain: the caller keeps the original promise
      // (and its rejection), while this one only removes the entry, so a
      // failed handler never becomes an unhandled rejection here.
      promise.then(settle, settle)
      return promise
    },
    async drain(timeoutMs = 3_000): Promise<boolean> {
      draining = true
      if (inflight.size === 0) return true
      // The snapshot is complete: `draining` blocks new entries, so nothing
      // can join the set after this line. The allSettled chain never rejects,
      // so a rejection here can only be the timeout.
      const settled = Promise.allSettled([...inflight]).then(() => true as const)
      return withTimeout(settled, timeoutMs).catch(() => false as const)
    },
  }
}

export * as WorkerGate from "./worker-gate"
