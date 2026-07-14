import {
  OpencodeXSwarmAgentRunTable,
  OpencodeXSwarmRoleTable,
  OpencodeXSwarmRunTable,
  OpencodeXSwarmTable,
} from "@opencode-ai/core/opencodex/sql"
import { Database } from "@opencode-ai/core/database/database"
import { OpencodeXJob } from "@/opencodex/job"
import { OpencodeXJobDispatcher } from "@/opencodex/job-dispatcher"
import { Effect } from "effect"
import { eq } from "drizzle-orm"
import { ReadService, type RoleStatus } from "./swarm-schema"
import { SwarmExecution } from "./swarm-execution"
import { SwarmStatus } from "./swarm-status"

export const registerExecutors = Effect.fn("OpencodeXSwarm.registerExecutors")(function* () {
  const dispatcher = yield* OpencodeXJobDispatcher.Service
  const execution = yield* SwarmExecution
  const status = yield* SwarmStatus
  const unregisterOrchestrator = yield* dispatcher.register(
    "swarm.orchestrator",
    execution.executeOrchestrator,
    status.settleRoleJob,
  )
  const unregisterWorker = yield* dispatcher.register("swarm.worker", execution.executeWorker, status.settleRoleJob)
  const unregisterSynthesis = yield* dispatcher.register(
    "swarm.synthesis",
    execution.executeSynthesis,
    status.settleSynthesisJob,
  )
  yield* Effect.addFinalizer(() =>
    Effect.all([unregisterOrchestrator, unregisterWorker, unregisterSynthesis], {
      concurrency: "unbounded",
      discard: true,
    }),
  )
  yield* dispatcher.wake()
})

function roleStatus(job: OpencodeXJob.Info): RoleStatus {
  if (job.status === "cancelled") return "cancelled"
  if (job.cancelRequestedAt) return "cancelling"
  if (job.status === "succeeded") return "completed"
  if (["failed", "interrupted"].includes(job.status)) return "failed"
  if (["claimed", "running"].includes(job.status)) return "running"
  return "queued"
}

export const reconcileInterruptedRuns = Effect.fn("OpencodeXSwarm.reconcileInterruptedRuns")(function* () {
  const { db } = yield* Database.Service
  const reader = yield* ReadService
  const jobs = yield* OpencodeXJob.Service
  const status = yield* SwarmStatus
  const [swarms, jobList] = yield* Effect.all([reader.list(), jobs.list()], { concurrency: "unbounded" })
  yield* Effect.forEach(
    swarms.flatMap((swarm) =>
      swarm.runs
        .filter((run) => ["queued", "running", "cancelling"].includes(run.status))
        .map((run) => ({ swarm, run })),
    ),
    ({ swarm, run }) =>
      Effect.gen(function* () {
        const related = jobList.filter((job) => job.swarmID === swarm.id && job.metadata?.runID === run.id)
        if (related.length === 0) {
          yield* status.updateRunStatus(swarm.id, run.id, "failed", "Recovered swarm run without durable jobs")
          return
        }
        yield* Effect.forEach(
          related.filter((job) => job.status === "queued" && job.metadata?.dispatchReady === false),
          (job) => jobs.update({ id: job.id, metadata: { ...job.metadata, dispatchReady: true } }).pipe(Effect.ignore),
          { concurrency: 1, discard: true },
        )
        const roleJobs = related.filter((job) => job.roleID)
        const changed = roleJobs.some((job) => {
          const next = roleStatus(job)
          const role = swarm.roles.find((item) => item.id === job.roleID)
          const agentRun = run.agents.find((item) => item.jobID === job.id)
          return role?.status !== next || role?.sessionID !== job.sessionID || agentRun?.status !== next || agentRun?.sessionID !== job.sessionID
        })
        const active = related.some((job) => ["queued", "claimed", "running"].includes(job.status))
        const aggregateStatus =
          swarm.status === "cancelling" || related.some((job) => job.cancelRequestedAt)
            ? "cancelling"
            : related.some((job) => ["claimed", "running"].includes(job.status))
              ? "running"
              : "queued"
        if (changed || (active && run.status !== aggregateStatus)) {
          const now = Date.now()
          const afterCommit = yield* db
            .transaction(
              (transaction) =>
                Effect.gen(function* () {
                  yield* Effect.forEach(
                    roleJobs,
                    (job) => {
                      const next = roleStatus(job)
                      const role = swarm.roles.find((item) => item.id === job.roleID)
                      const agentRun = run.agents.find((item) => item.jobID === job.id)
                      return Effect.all(
                        [
                          ...(role
                            ? [
                                transaction
                                  .update(OpencodeXSwarmRoleTable)
                                  .set({ status: next, session_id: job.sessionID, time_updated: now })
                                  .where(eq(OpencodeXSwarmRoleTable.id, role.id))
                                  .run(),
                              ]
                            : []),
                          ...(agentRun
                            ? [
                                transaction
                                  .update(OpencodeXSwarmAgentRunTable)
                                  .set({
                                    status: next,
                                    session_id: job.sessionID,
                                    completed_at: ["completed", "failed", "cancelled"].includes(next)
                                      ? job.completedAt
                                      : undefined,
                                    time_updated: now,
                                  })
                                  .where(eq(OpencodeXSwarmAgentRunTable.id, agentRun.id))
                                  .run(),
                              ]
                            : []),
                        ],
                        { concurrency: 1, discard: true },
                      )
                    },
                    { concurrency: 1, discard: true },
                  )
                  if (active) {
                    yield* transaction
                      .update(OpencodeXSwarmRunTable)
                      .set({ status: aggregateStatus, time_updated: now })
                      .where(eq(OpencodeXSwarmRunTable.id, run.id))
                      .run()
                    yield* transaction
                      .update(OpencodeXSwarmTable)
                      .set({ status: aggregateStatus, time_updated: now })
                      .where(eq(OpencodeXSwarmTable.id, swarm.id))
                      .run()
                  }
                  return yield* status.commitEvent(transaction, swarm.id, {
                    runID: run.id,
                    kind: "swarm.run.recovered",
                    message: "Recovered durable swarm state",
                  })
                }),
              { behavior: "immediate" },
            )
            .pipe(Effect.orDie)
          yield* afterCommit
        }
        if (active) return
        yield* status.completeIfFinished(swarm.id, run.id).pipe(
          Effect.catchTag("OpencodeX.Swarm.NotFoundError", () => Effect.void),
        )
      }),
    { concurrency: 1, discard: true },
  )
})
