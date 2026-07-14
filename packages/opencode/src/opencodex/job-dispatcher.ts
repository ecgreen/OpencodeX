import { EventV2Bridge } from "@/event-v2-bridge"
import { errorMessage } from "@/util/error"
import { Cause, Context, Effect, Exit, Fiber, Layer, Option, Queue, Schedule, Scope } from "effect"
import { OpencodeXJob } from "./job"

export type Executor = (
  job: OpencodeXJob.Info,
  signal: AbortSignal,
) => Effect.Effect<Record<string, unknown> | void, unknown>

export type Settled = OpencodeXJob.TransactionalSettlement

export type Options = {
  concurrency?: number
  leaseMs?: number
  heartbeatMs?: number
  recoveryMs?: number
  accepts?: (job: OpencodeXJob.Info) => boolean
}

export interface Interface {
  readonly register: (kind: string, executor: Executor, settled?: Settled) => Effect.Effect<Effect.Effect<void>>
  readonly wake: () => Effect.Effect<void>
  readonly running: () => readonly string[]
}

export class Service extends Context.Service<Service, Interface>()("@opencode/OpencodeXJobDispatcher") {}

export function layer(options: Options = {}) {
  return Layer.effect(
    Service,
    Effect.gen(function* () {
      const jobs = yield* OpencodeXJob.Service
      const events = yield* EventV2Bridge.Service
      const scope = yield* Scope.Scope
      const wakeups = yield* Queue.unbounded<void>()
      const executors = new Map<string, { executor: Executor; settled?: Settled }>()
      const active = new Map<
        string,
        {
          controller: AbortController
          owner: string
          handler: { executor: Executor; settled?: Settled }
        }
      >()
      const concurrency = options.concurrency ?? 4
      const leaseMs = options.leaseMs ?? 30_000
      const heartbeatMs = options.heartbeatMs ?? Math.max(1_000, Math.floor(leaseMs / 3))

      const wake = () => Queue.offer(wakeups, undefined).pipe(Effect.asVoid)

      const finish = Effect.fn("OpencodeXJobDispatcher.finish")(function* (
        job: OpencodeXJob.Info,
        handler: { executor: Executor; settled?: Settled },
        owner: string,
        exit: Exit.Exit<Record<string, unknown> | void, unknown>,
      ) {
        const latest = yield* jobs.get(job.id).pipe(Effect.option)
        if (Option.isNone(latest) || latest.value.status === "cancelled") return
        if (latest.value.cancelRequestedAt) {
          yield* jobs
            .settle({ jobID: job.id, owner, outcome: { status: "cancelled" } }, handler.settled)
            .pipe(Effect.ignore)
          return
        }
        if (Exit.isSuccess(exit)) {
          yield* jobs
            .settle(
              {
                jobID: job.id,
                owner,
                outcome: { status: "succeeded", result: exit.value === undefined ? undefined : exit.value },
              },
              handler.settled,
            )
            .pipe(Effect.ignore)
          return
        }
        const message = errorMessage(Cause.squash(exit.cause))
        if (latest.value.attempt >= latest.value.maxAttempts) {
          yield* jobs
            .settle(
              {
                jobID: job.id,
                owner,
                outcome: { status: "failed", failure: { code: "JOB_EXECUTION_FAILED", message } },
              },
              handler.settled,
            )
            .pipe(Effect.ignore)
          return
        }
        const failed = yield* jobs
          .fail({ jobID: job.id, owner, failure: { code: "JOB_EXECUTION_FAILED", message } })
          .pipe(Effect.option)
        if (Option.isNone(failed)) return
        yield* jobs.retry(job.id).pipe(Effect.ignore)
      })

      const execute = Effect.fn("OpencodeXJobDispatcher.execute")(function* (
        job: OpencodeXJob.Info,
        handler: { executor: Executor; settled?: Settled },
        owner: string,
        controller: AbortController,
      ) {
        const running = yield* jobs.start(job.id, owner)
        const heartbeat = yield* Effect.sleep(heartbeatMs).pipe(
          Effect.andThen(jobs.renew({ jobID: job.id, owner, leaseMs })),
          Effect.tapError(() => Effect.sync(() => controller.abort("Job lease renewal failed"))),
          Effect.ignore,
          Effect.repeat(Schedule.forever),
          Effect.forkScoped,
        )
        const timeout = running.timeoutAt
          ? Effect.sleep(Math.max(0, running.timeoutAt - Date.now())).pipe(
              Effect.tap(() => Effect.sync(() => controller.abort("Job timed out"))),
              Effect.andThen(Effect.fail(new Error("Job timed out"))),
            )
          : Effect.never
        const exit = yield* handler.executor(running, controller.signal).pipe(Effect.raceFirst(timeout), Effect.exit)
        controller.abort()
        yield* Fiber.interrupt(heartbeat).pipe(Effect.ignore)
        yield* finish(running, handler, owner, exit)
      })

      const release = Effect.fn("OpencodeXJobDispatcher.release")(function* (
        jobID: string,
        current: {
          controller: AbortController
          owner: string
          handler: { executor: Executor; settled?: Settled }
        },
      ) {
        current.controller.abort("Job dispatcher stopped")
        const job = yield* jobs.get(jobID)
        if (job.cancelRequestedAt) {
          yield* jobs.settle(
            { jobID, owner: current.owner, outcome: { status: "cancelled" } },
            current.handler.settled,
          )
          return
        }
        const failed = yield* jobs.fail({
          jobID,
          owner: current.owner,
          failure: { code: "JOB_DISPATCHER_STOPPED", message: "Job dispatcher stopped during execution" },
        })
        if (failed.attempt < failed.maxAttempts) yield* jobs.retry(jobID)
      })

      const dispatch = Effect.fn("OpencodeXJobDispatcher.dispatch")(function* () {
        const capacity = concurrency - active.size
        if (capacity <= 0) return
        const all = yield* jobs.list()
        const byID = new Map(all.map((job) => [job.id, job]))
        yield* Effect.forEach(
          all.filter((job) => {
            if (job.status !== "queued" || !job.parentJobID) return false
            const parent = byID.get(job.parentJobID)
            return parent !== undefined && ["failed", "cancelled", "interrupted"].includes(parent.status)
          }),
          (job) => jobs.cancel(job.id, executors.get(job.kind)?.settled).pipe(Effect.ignore),
          { concurrency: 1, discard: true },
        )
        const queued = all.filter(
          (job) =>
            job.status === "queued" &&
            !active.has(job.id) &&
            executors.has(job.kind) &&
            job.metadata?.dispatchReady !== false &&
            (!job.parentJobID || byID.get(job.parentJobID)?.status === "succeeded") &&
            (options.accepts?.(job) ?? true),
        )
        yield* Effect.forEach(
          queued.slice(0, capacity),
          (job) =>
            Effect.gen(function* () {
              const handler = executors.get(job.kind)
              if (!handler) return
              const owner = `local:${process.pid}:dispatcher:${job.id}`
              const claimed = yield* jobs.claim({ jobID: job.id, owner, leaseMs }).pipe(Effect.option)
              if (Option.isNone(claimed)) return
              const controller = new AbortController()
              const current = { controller, owner, handler }
              active.set(job.id, current)
              yield* execute(claimed.value, handler, owner, controller).pipe(
                Effect.onInterrupt(() => release(job.id, current).pipe(Effect.ignore)),
                Effect.catchCause((cause) => Effect.logError("job execution fiber failed", { jobID: job.id, cause })),
                Effect.ensuring(
                  Effect.sync(() => {
                    active.delete(job.id)
                    Queue.offerUnsafe(wakeups, undefined)
                  }),
                ),
                Effect.forkIn(scope, { startImmediately: true }),
              )
            }),
          { concurrency: 1, discard: true },
        )
      })

      const recover = Effect.fn("OpencodeXJobDispatcher.recover")(function* () {
        const recovered = yield* jobs.recover()
        yield* Effect.forEach(
          recovered.filter((job) => job.attempt < job.maxAttempts),
          (job) => jobs.retry(job.id).pipe(Effect.ignore),
          { concurrency: 1, discard: true },
        )
        yield* wake()
      })

      const unsubscribe = yield* events.listen((event) => {
        if (event.type !== OpencodeXJob.Event.Created.type && event.type !== OpencodeXJob.Event.Transitioned.type)
          return Effect.void
        if (!event.data || typeof event.data !== "object" || !("jobID" in event.data) || !("status" in event.data))
          return Effect.void
        const jobID = String(event.data.jobID)
        const current = active.get(jobID)
        if (!current) return wake()
        return jobs.get(jobID).pipe(
          Effect.tap((job) =>
            job.cancelRequestedAt
              ? Effect.sync(() => current.controller.abort("Job cancellation requested"))
              : Effect.void,
          ),
          Effect.ignore,
          Effect.andThen(wake()),
        )
      })
      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          for (const current of active.values()) current.controller.abort("Job dispatcher stopped")
          yield* Effect.forEach(
            [...active.entries()],
            ([jobID, current]) => release(jobID, current).pipe(Effect.ignore),
            { concurrency: 1, discard: true },
          )
          yield* unsubscribe
        }),
      )

      yield* recover()
      yield* Queue.take(wakeups).pipe(Effect.andThen(dispatch()), Effect.forever, Effect.forkIn(scope))
      yield* Effect.sleep(options.recoveryMs ?? 10_000).pipe(
        Effect.andThen(recover()),
        Effect.repeat(Schedule.forever),
        Effect.forkIn(scope),
      )

      return Service.of({
        register(kind, executor, settled) {
          return Effect.sync(() => {
            const handler = { executor, settled }
            executors.set(kind, handler)
            Queue.offerUnsafe(wakeups, undefined)
            return Effect.sync(() => {
              if (executors.get(kind) === handler) executors.delete(kind)
            })
          })
        },
        wake,
        running: () => [...active.keys()],
      })
    }),
  )
}

export const defaultLayer = layer().pipe(
  Layer.provide(OpencodeXJob.defaultLayer),
  Layer.provide(EventV2Bridge.defaultLayer),
)

export * as OpencodeXJobDispatcher from "./job-dispatcher"
