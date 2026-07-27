import {
  OpencodeXSwarmAgentRunTable,
  OpencodeXSwarmEventTable,
  OpencodeXSwarmRoleTable,
  OpencodeXSwarmRunTable,
  OpencodeXSwarmTable,
} from "@opencode-ai/core/opencodex/sql"
import { Database } from "@opencode-ai/core/database/database"
import { Identifier } from "@opencode-ai/core/util/identifier"
import { EventV2Bridge } from "@/event-v2-bridge"
import { OpencodeXJob } from "@/opencodex/job"
import { MessageID, SessionID } from "@/session/schema"
import { Context, Effect, Layer } from "effect"
import { and, eq, inArray } from "drizzle-orm"
import { NotFoundError, ReadService, StateEvent, type RoleStatus, type Status } from "./swarm-schema"
import { serializeMetadata } from "./swarm-model"

export type EventInput = {
  runID?: string
  roleID?: string
  sessionID?: SessionID
  kind: string
  message: string
  metadata?: Record<string, unknown>
}

export interface Interface {
  readonly commitEvent: (
    transaction: OpencodeXJob.Transaction,
    swarmID: string,
    input: EventInput,
  ) => Effect.Effect<Effect.Effect<void>>
  readonly event: (swarmID: string, input: EventInput) => Effect.Effect<void>
  readonly updateRunStatus: (
    swarmID: string,
    runID: string,
    status: Status,
    message: string,
    sessionID?: SessionID,
  ) => Effect.Effect<void>
  readonly completeIfFinished: (swarmID: string, runID?: string) => Effect.Effect<void, NotFoundError>
  readonly settleRoleJob: OpencodeXJob.TransactionalSettlement
  readonly settleSynthesisJob: OpencodeXJob.TransactionalSettlement
}

export class SwarmStatus extends Context.Service<SwarmStatus, Interface>()("@opencode/OpencodeXSwarmStatus") {}

export const swarmStatusLayer = Layer.effect(
  SwarmStatus,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const stateEvents = yield* EventV2Bridge.Service
    const reader = yield* ReadService
    const jobs = yield* OpencodeXJob.Service

    const commitEvent = (
      transaction: OpencodeXJob.Transaction,
      swarmID: string,
      input: EventInput,
    ) =>
      Effect.gen(function* () {
        const now = Date.now()
        yield* transaction
          .insert(OpencodeXSwarmEventTable)
          .values({
            id: `oxe_${Identifier.ascending()}`,
            swarm_id: swarmID,
            run_id: input.runID,
            role_id: input.roleID,
            session_id: input.sessionID,
            kind: input.kind,
            message: input.message,
            metadata_json: serializeMetadata(input.metadata),
            time_created: now,
            time_updated: now,
          })
          .run()
        const committed = yield* stateEvents.commit(StateEvent.Updated, { swarmID })
        return stateEvents.broadcast(committed).pipe(Effect.asVoid)
      }).pipe(Effect.orDie)

    const event = Effect.fn("OpencodeXSwarm.event")(function* (swarmID: string, input: EventInput) {
      const afterCommit = yield* stateEvents.barrier(
        db
          .transaction((transaction) => commitEvent(transaction, swarmID, input), { behavior: "immediate" })
          .pipe(Effect.orDie),
      )
      yield* afterCommit
    })

    const updateRunStatus = Effect.fn("OpencodeXSwarm.updateRunStatus")(function* (
      swarmID: string,
      runID: string,
      status: Status,
      message: string,
      sessionID?: SessionID,
    ) {
      const terminal = ["completed", "partially_failed", "failed", "cancelled"].includes(status)
      const now = Date.now()
      const afterCommit = yield* stateEvents.barrier(
        db.transaction(
          (transaction) =>
            Effect.gen(function* () {
              const run = yield* transaction
                .select({ prompt: OpencodeXSwarmRunTable.prompt, status: OpencodeXSwarmRunTable.status })
                .from(OpencodeXSwarmRunTable)
                .where(eq(OpencodeXSwarmRunTable.id, runID))
                .get()
              if (!run) return Effect.void
              if (["completed", "partially_failed", "failed", "cancelled"].includes(run.status)) return Effect.void
              yield* transaction
                .update(OpencodeXSwarmRunTable)
                .set({
                  status,
                  result_session_id: ["completed", "partially_failed"].includes(status) ? sessionID : undefined,
                  completed_at: terminal ? now : undefined,
                  time_updated: now,
                })
                .where(eq(OpencodeXSwarmRunTable.id, runID))
                .run()
              yield* transaction
                .update(OpencodeXSwarmTable)
                .set({
                  status,
                  prompt: run.prompt,
                  synthesis_session_id: ["completed", "partially_failed"].includes(status) ? sessionID : undefined,
                  completed_at: terminal ? now : undefined,
                  time_updated: now,
                })
                .where(eq(OpencodeXSwarmTable.id, swarmID))
                .run()
              return yield* commitEvent(transaction, swarmID, {
                runID,
                sessionID,
                kind: `swarm.run.${status}`,
                message,
              })
            }),
          { behavior: "immediate" },
        ).pipe(Effect.orDie),
      )
      yield* afterCommit
    })

    const completeIfFinished = Effect.fn("OpencodeXSwarm.completeIfFinished")(function* (
      swarmID: string,
      requestedRunID?: string,
    ) {
      const swarm = yield* reader.get(swarmID)
      const run = requestedRunID
        ? swarm.runs.find((item) => item.id === requestedRunID)
        : swarm.runs.toSorted((left, right) => right.timeCreated - left.timeCreated)[0]
      if (!run || ["completed", "partially_failed", "failed", "cancelled"].includes(run.status)) return
      const related = (yield* jobs.list()).filter(
        (job) => job.swarmID === swarmID && job.metadata?.runID === run.id,
      )
      if (related.some((job) => ["queued", "claimed", "running"].includes(job.status))) return
      if (
        ["cancelling"].includes(swarm.status) ||
        related.some((job) => job.status === "cancelled")
      ) {
        yield* updateRunStatus(swarmID, run.id, "cancelled", "Swarm cancellation acknowledged")
        return
      }
      const synthesis = related.find((job) => job.kind === "swarm.synthesis")
      if (synthesis) {
        if (!["succeeded", "failed", "cancelled", "interrupted"].includes(synthesis.status)) return
        const status: Status =
          synthesis.status === "succeeded"
            ? synthesis.metadata?.partialFailure === true
              ? "partially_failed"
              : "completed"
            : synthesis.status === "cancelled"
              ? "cancelled"
              : "failed"
        yield* updateRunStatus(
          swarmID,
          run.id,
          status,
          `Recovered ${status.replaceAll("_", " ")} swarm run`,
          synthesis.sessionID,
        )
        return
      }
      const orchestrator = related.find((job) => job.kind === "swarm.orchestrator")
      if (!orchestrator || orchestrator.status !== "succeeded") {
        const cancelled = swarm.status === "cancelling" || related.some((job) => job.status === "cancelled")
        yield* updateRunStatus(
          swarmID,
          run.id,
          cancelled ? "cancelled" : "failed",
          cancelled ? "Swarm cancellation acknowledged" : "Swarm orchestrator did not complete",
        )
        return
      }
      const workers = related.filter((job) => job.kind === "swarm.worker")
      const successfulWorkers = workers.filter((job) => job.status === "succeeded")
      if (workers.length > 0 && successfulWorkers.length === 0) {
        yield* updateRunStatus(swarmID, run.id, "failed", "Every swarm worker failed or was interrupted")
        return
      }
      yield* jobs.create({
        kind: "swarm.synthesis",
        title: `${swarm.title}: Synthesis`,
        source: "swarm",
        projectID: swarm.projectID,
        parentJobID: orchestrator.id,
        swarmID,
        idempotencyKey: `${run.id}:synthesis`,
        maxAttempts: 2,
        timeoutAt: Date.now() + 2 * 60 * 60 * 1_000,
        metadata: {
          runID: run.id,
          phase: "synthesis",
          sessionID: SessionID.descending(),
          messageID: MessageID.ascending(),
          partialFailure: workers.some((job) => job.status !== "succeeded"),
          dispatchReady: true,
        },
      })
    })

    const roleStatus = (job: OpencodeXJob.Info): RoleStatus => {
      if (job.status === "cancelled") return "cancelled"
      if (job.status === "succeeded") return "completed"
      return "failed"
    }

    const settleRoleJob: OpencodeXJob.TransactionalSettlement = (job, transaction) =>
      Effect.gen(function* () {
        if (!job.swarmID || !job.roleID || typeof job.metadata?.runID !== "string") return Effect.void
        const status = roleStatus(job)
        const now = job.completedAt ?? Date.now()
        yield* transaction
          .update(OpencodeXSwarmAgentRunTable)
          .set({ status, session_id: job.sessionID, completed_at: now, time_updated: now })
          .where(eq(OpencodeXSwarmAgentRunTable.job_id, job.id))
          .run()
        yield* transaction
          .update(OpencodeXSwarmRoleTable)
          .set({ status, session_id: job.sessionID, time_updated: now })
          .where(and(eq(OpencodeXSwarmRoleTable.id, job.roleID), eq(OpencodeXSwarmRoleTable.job_id, job.id)))
          .run()
        const broadcast = yield* commitEvent(transaction, job.swarmID, {
          runID: job.metadata.runID,
          roleID: job.roleID,
          sessionID: job.sessionID,
          kind: `swarm.role.${status}`,
          message: `${job.title ?? "Swarm role"} ${status.replaceAll("_", " ")}`,
        })
        return broadcast.pipe(
          Effect.andThen(
            completeIfFinished(job.swarmID, job.metadata.runID).pipe(
              Effect.catchTag("OpencodeX.Swarm.NotFoundError", () => Effect.void),
            ),
          ),
        )
      }).pipe(Effect.orDie)

    const settleSynthesisJob: OpencodeXJob.TransactionalSettlement = (job, transaction) =>
      Effect.gen(function* () {
        if (!job.swarmID || typeof job.metadata?.runID !== "string") return Effect.void
        const status: Status =
          job.status === "succeeded"
            ? job.metadata.partialFailure === true
              ? "partially_failed"
              : "completed"
            : job.status === "cancelled"
              ? "cancelled"
              : "failed"
        const now = job.completedAt ?? Date.now()
        const updated = yield* transaction
          .update(OpencodeXSwarmRunTable)
          .set({ status, result_session_id: job.sessionID, completed_at: now, time_updated: now })
          .where(
            and(
              eq(OpencodeXSwarmRunTable.id, job.metadata.runID),
              inArray(OpencodeXSwarmRunTable.status, ["planned", "queued", "running", "cancelling"]),
            ),
          )
          .returning({ id: OpencodeXSwarmRunTable.id })
          .get()
        if (!updated) return Effect.void
        yield* transaction
          .update(OpencodeXSwarmTable)
          .set({ status, synthesis_session_id: job.sessionID, completed_at: now, time_updated: now })
          .where(eq(OpencodeXSwarmTable.id, job.swarmID))
          .run()
        return yield* commitEvent(transaction, job.swarmID, {
          runID: job.metadata.runID,
          sessionID: job.sessionID,
          kind: `swarm.run.${status}`,
          message:
            status === "partially_failed" ? "Swarm completed with partial worker failures" : `Swarm ${status}`,
        })
      }).pipe(Effect.orDie)

    return SwarmStatus.of({
      commitEvent,
      event,
      updateRunStatus,
      completeIfFinished,
      settleRoleJob,
      settleSynthesisJob,
    })
  }),
)
