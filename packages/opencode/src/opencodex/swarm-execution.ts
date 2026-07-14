import {
  OpencodeXSwarmAgentRunTable,
  OpencodeXSwarmRoleTable,
  OpencodeXSwarmRunTable,
  OpencodeXSwarmTable,
} from "@opencode-ai/core/opencodex/sql"
import { Database } from "@opencode-ai/core/database/database"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Agent } from "@/agent/agent"
import { BackgroundJob } from "@/background/job"
import { InstanceRef } from "@/effect/instance-ref"
import type { InstanceContext } from "@/project/instance-context"
import { OpencodeXJob } from "@/opencodex/job"
import { OpencodeXProject } from "@/opencodex/project"
import { Provider } from "@/provider/provider"
import { Session } from "@/session/session"
import { MessageID, SessionID } from "@/session/schema"
import { SessionPrompt } from "@/session/prompt"
import { Context, Effect, Layer } from "effect"
import { eq } from "drizzle-orm"
import { ReadService, ValidationError, type Info, type Role, type Run } from "./swarm-schema"
import {
  messageText,
  orchestratorRunPrompt,
  rolePrompt,
  selectedRoleModel,
  synthesisPrompt,
  waitForAbort,
} from "./swarm-model"
import { SwarmStatus } from "./swarm-status"

type Model = {
  providerID: ProviderV2.ID
  modelID: ProviderV2.ModelID
}

type JobContext = {
  swarm: Info
  run: Run
  directory: string
  instance: InstanceContext
}

export interface Interface {
  readonly executeOrchestrator: import("./job-dispatcher").Executor
  readonly executeWorker: import("./job-dispatcher").Executor
  readonly executeSynthesis: import("./job-dispatcher").Executor
  readonly cancelSessionTree: (sessionID: string) => Effect.Effect<void>
}

export class SwarmExecution extends Context.Service<SwarmExecution, Interface>()(
  "@opencode/OpencodeXSwarmExecution",
) {}

export const swarmExecutionLayer = Layer.effect(
  SwarmExecution,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const reader = yield* ReadService
    const projects = yield* OpencodeXProject.Service
    const jobs = yield* OpencodeXJob.Service
    const provider = yield* Provider.Service
    const agents = yield* Agent.Service
    const sessions = yield* Session.Service
    const prompt = yield* SessionPrompt.Service
    const background = yield* BackgroundJob.Service
    const status = yield* SwarmStatus

function metadataString(job: OpencodeXJob.Info, key: string) {
  const value = job.metadata?.[key]
  return typeof value === "string" ? value : undefined
}

function persistedSessionID(job: OpencodeXJob.Info) {
  const value = job.sessionID ?? metadataString(job, "sessionID")
  if (!value) return Effect.fail(new Error(`Swarm job ${job.id} has no persisted session ID`))
  return Effect.succeed(SessionID.make(value))
}

function persistedMessageID(job: OpencodeXJob.Info) {
  const value = metadataString(job, "messageID")
  if (!value) return Effect.fail(new Error(`Swarm job ${job.id} has no persisted prompt message ID`))
  return Effect.succeed(MessageID.make(value))
}

const jobContext = Effect.fn("OpencodeXSwarm.jobContext")(function* (job: OpencodeXJob.Info) {
  if (!job.swarmID || typeof job.metadata?.runID !== "string") {
    return yield* Effect.fail(new Error(`Invalid swarm job ${job.id}`))
  }
  const swarm = yield* reader.get(job.swarmID).pipe(Effect.orDie)
  const run = swarm.runs.find((item) => item.id === job.metadata?.runID)
  if (!run) return yield* Effect.fail(new Error(`Incomplete swarm graph ${job.id}`))
  const project = yield* projects.get(swarm.projectID).pipe(Effect.orDie)
  const directory = project.folders[0]?.path ?? project.project.worktree
  return {
    swarm,
    run,
    directory,
    instance: {
      directory,
      worktree: project.project.worktree,
      project: {
        ...project.project,
        icon: project.project.icon ? { ...project.project.icon } : undefined,
        commands: project.project.commands ? { ...project.project.commands } : undefined,
        time: { ...project.project.time },
        sandboxes: [...project.project.sandboxes],
      },
      opencodex: { folders: project.folders.map((folder) => folder.path) },
    },
  } satisfies JobContext
})

function roleContext(job: OpencodeXJob.Info, context: JobContext) {
  const role = context.swarm.roles.find((item) => item.id === job.roleID)
  const agentRun = context.run.agents.find((item) => item.jobID === job.id)
  if (!role || !agentRun) return Effect.fail(new Error(`Incomplete swarm role graph ${job.id}`))
  return Effect.succeed({ ...context, role, agentRun })
}

const defaultModel = Effect.fn("OpencodeXSwarm.defaultModel")(function* () {
  const missing = "Select a model for every swarm role or configure a default model."
  return yield* provider.defaultModel().pipe(
    Effect.catchTags({
      ProviderModelNotFoundError: () => Effect.fail(new ValidationError({ message: missing })),
      ProviderNoModelsError: () => Effect.fail(new ValidationError({ message: missing })),
      ProviderNoProvidersError: () => Effect.fail(new ValidationError({ message: missing })),
    }),
  )
})

const resolveModel = Effect.fn("OpencodeXSwarm.resolveJobModel")(function* (
  job: OpencodeXJob.Info,
  role?: Role,
) {
  if (job.providerID && job.modelID) {
    return {
      providerID: ProviderV2.ID.make(job.providerID),
      modelID: ProviderV2.ModelID.make(job.modelID),
    }
  }
  const selected = role ? selectedRoleModel(role) : undefined
  return selected ?? (yield* defaultModel())
})

const resolveAgent = Effect.fn("OpencodeXSwarm.resolveJobAgent")(function* (job: OpencodeXJob.Info, role?: Role) {
  const requested = job.agent ?? role?.agent
  if (!requested) return yield* agents.defaultAgent().pipe(Effect.orDie)
  return yield* agents.get(requested).pipe(
    Effect.as(requested),
    Effect.catchCause(() => agents.defaultAgent().pipe(Effect.orDie)),
  )
})

const prepareSession = Effect.fn("OpencodeXSwarm.prepareSession")(function* (input: {
  job: OpencodeXJob.Info
  context: JobContext
  sessionID: SessionID
  title: string
  agent: string
  model: Model
  role: string
  roleID?: string
}) {
  const variant = metadataString(input.job, "variant")
  const session = yield* projects
    .createSession({
      projectID: input.context.swarm.projectID,
      directory: input.context.directory,
      sessionID: input.sessionID,
      title: input.title,
      agent: input.agent,
      model: {
        providerID: input.model.providerID,
        id: input.model.modelID,
        ...(variant ? { variant } : {}),
      },
      hidden: true,
      metadata: {
        opencodex: {
          swarmID: input.context.swarm.id,
          runID: input.context.run.id,
          roleID: input.roleID,
          role: input.role,
        },
      },
    })
    .pipe(Effect.orDie)
  if (input.job.sessionID !== session.id) {
    yield* jobs.update({ id: input.job.id, sessionID: session.id }).pipe(Effect.orDie)
  }
  return session
})

const markRunning = Effect.fn("OpencodeXSwarm.markPhaseRunning")(function* (
  job: OpencodeXJob.Info,
  sessionID: SessionID,
) {
  if (!job.swarmID || typeof job.metadata?.runID !== "string") return
  const swarmID = job.swarmID
  const runID = job.metadata.runID
  const now = Date.now()
  const afterCommit = yield* db
    .transaction(
      (transaction) =>
        Effect.gen(function* () {
          if (job.roleID) {
            yield* transaction
              .update(OpencodeXSwarmAgentRunTable)
              .set({ status: "running", session_id: sessionID, started_at: now, time_updated: now })
              .where(eq(OpencodeXSwarmAgentRunTable.job_id, job.id))
              .run()
            yield* transaction
              .update(OpencodeXSwarmRoleTable)
              .set({ status: "running", session_id: sessionID, job_id: job.id, time_updated: now })
              .where(eq(OpencodeXSwarmRoleTable.id, job.roleID))
              .run()
          }
          yield* transaction
            .update(OpencodeXSwarmRunTable)
            .set({
              status: "running",
              orchestrator_session_id: job.kind === "swarm.orchestrator" ? sessionID : undefined,
              time_updated: now,
            })
            .where(eq(OpencodeXSwarmRunTable.id, runID))
            .run()
          yield* transaction
            .update(OpencodeXSwarmTable)
            .set({
              status: "running",
              synthesis_session_id: job.kind === "swarm.synthesis" ? sessionID : undefined,
              time_updated: now,
            })
            .where(eq(OpencodeXSwarmTable.id, swarmID))
            .run()
          return yield* status.commitEvent(transaction, swarmID, {
            runID,
            roleID: job.roleID,
            sessionID,
            kind: `${job.kind}.started`,
            message: `${job.title ?? "Swarm phase"} started`,
          })
        }),
      { behavior: "immediate" },
    )
    .pipe(Effect.orDie)
  yield* afterCommit
})

const cancelSessionTree: (sessionID: string) => Effect.Effect<void> =
  Effect.fn("OpencodeXSwarm.cancelSessionTree")(function* (sessionID: string) {
    const id = SessionID.make(sessionID)
    yield* prompt.cancel(id).pipe(Effect.ignore)
    const backgroundJobs = yield* background.list()
    yield* Effect.forEach(
      backgroundJobs.filter((job) => {
        if (job.status !== "running") return false
        if (job.id === sessionID) return true
        if (job.metadata?.sessionId === sessionID) return true
        return job.metadata?.parentSessionId === sessionID
      }),
      (job) => background.cancel(job.id),
      { concurrency: "unbounded", discard: true },
    )
    const children = yield* sessions.children(id).pipe(Effect.catchCause(() => Effect.succeed([])))
    yield* Effect.forEach(children, (child) => cancelSessionTree(child.id), {
      concurrency: "unbounded",
      discard: true,
    })
  })

const runDurablePrompt = Effect.fn("OpencodeXSwarm.runDurablePrompt")(function* (input: {
  job: OpencodeXJob.Info
  sessionID: SessionID
  agent: string
  model: Model
  text: string
  signal: AbortSignal
}) {
  const messageID = yield* persistedMessageID(input.job)
  const messages = yield* sessions.messages({ sessionID: input.sessionID }).pipe(Effect.orDie)
  const completed = messages.find(
    (message) =>
      message.info.role === "assistant" &&
      message.info.parentID === messageID &&
      message.info.time.completed !== undefined &&
      message.info.error === undefined,
  )
  if (completed) return { sessionID: input.sessionID, messageID: completed.info.id }
  const existingPrompt = messages.some((message) => message.info.id === messageID && message.info.role === "user")
  const execution = existingPrompt
    ? prompt.loop({ sessionID: input.sessionID })
    : prompt.prompt({
        sessionID: input.sessionID,
        messageID,
        agent: input.agent,
        model: input.model,
        variant: metadataString(input.job, "variant"),
        parts: [{ type: "text", text: input.text }],
      })
  const result = yield* execution.pipe(
    Effect.raceFirst(waitForAbort(input.signal)),
    Effect.tapError(() => (input.signal.aborted ? cancelSessionTree(input.sessionID) : Effect.void)),
  )
  if (result.info.role === "assistant" && result.info.error) {
    return yield* Effect.fail(new Error("Swarm prompt ended before a successful assistant response was committed"))
  }
  return { sessionID: input.sessionID, messageID: result.info.id }
})

const executeOrchestrator = Effect.fn("OpencodeXSwarm.executeOrchestrator")(function* (
  job: OpencodeXJob.Info,
  signal: AbortSignal,
) {
  const context = yield* jobContext(job)
  const role = yield* roleContext(job, context)
  return yield* Effect.gen(function* () {
    const sessionID = yield* persistedSessionID(job)
    const model = yield* resolveModel(job, role.role)
    const agent = yield* resolveAgent(job, role.role)
    yield* prepareSession({
      job,
      context,
      sessionID,
      title: `${context.swarm.title}: ${context.run.title}`,
      agent,
      model,
      role: "orchestrator",
      roleID: role.role.id,
    })
    yield* markRunning(job, sessionID)
    const mode = metadataString(job, "executionMode") === "plan" ? "plan" : "build"
    return yield* runDurablePrompt({
      job,
      sessionID,
      agent,
      model,
      text: orchestratorRunPrompt({
        swarm: { ...context.swarm, prompt: context.run.prompt },
        run: context.run,
        orchestrator: role.role,
        roles: context.swarm.roles,
        mode,
      }),
      signal,
    })
  }).pipe(Effect.provideService(InstanceRef, context.instance))
})

const executeWorker = Effect.fn("OpencodeXSwarm.executeWorker")(function* (
  job: OpencodeXJob.Info,
  signal: AbortSignal,
) {
  const context = yield* jobContext(job)
  const role = yield* roleContext(job, context)
  return yield* Effect.gen(function* () {
    const sessionID = yield* persistedSessionID(job)
    const model = yield* resolveModel(job, role.role)
    const agent = yield* resolveAgent(job, role.role)
    yield* prepareSession({
      job,
      context,
      sessionID,
      title: `${context.swarm.title}: ${role.role.name}`,
      agent,
      model,
      role: role.role.skill ?? role.role.name,
      roleID: role.role.id,
    })
    yield* markRunning(job, sessionID)
    const coordination = context.run.orchestratorSessionID
      ? (yield* sessions.messages({ sessionID: SessionID.make(context.run.orchestratorSessionID) }).pipe(Effect.orDie))
          .filter((message) => message.info.role === "assistant")
          .map(messageText)
          .filter((text) => text.length > 0)
          .at(-1)
      : undefined
    return yield* runDurablePrompt({
      job,
      sessionID,
      agent,
      model,
      text: rolePrompt({
        swarm: { ...context.swarm, prompt: context.run.prompt },
        role: role.role,
        coordination,
      }),
      signal,
    })
  }).pipe(Effect.provideService(InstanceRef, context.instance))
})

const executeSynthesis = Effect.fn("OpencodeXSwarm.executeSynthesis")(function* (
  job: OpencodeXJob.Info,
  signal: AbortSignal,
) {
  const context = yield* jobContext(job)
  return yield* Effect.gen(function* () {
    const sessionID = yield* persistedSessionID(job)
    const model = yield* resolveModel(job, context.swarm.roles.find((role) => selectedRoleModel(role) !== undefined))
    const agent = yield* resolveAgent(job)
    yield* prepareSession({
      job,
      context,
      sessionID,
      title: `${context.swarm.title}: Synthesis`,
      agent,
      model,
      role: "synthesis",
    })
    yield* markRunning(job, sessionID)
    const outputs = yield* Effect.forEach(
      context.swarm.roles,
      Effect.fnUntraced(function* (role) {
        const agentRun = context.run.agents.find((item) => item.roleID === role.id)
        if (!agentRun?.sessionID) return { role, output: "" }
        const messages = yield* sessions.messages({ sessionID: SessionID.make(agentRun.sessionID) }).pipe(Effect.orDie)
        return {
          role,
          output:
            messages
              .filter((message) => message.info.role === "assistant")
              .map(messageText)
              .filter((text) => text.length > 0)
              .at(-1) ?? "",
        }
      }),
      { concurrency: "unbounded" },
    )
    return yield* runDurablePrompt({
      job,
      sessionID,
      agent,
      model,
      text: synthesisPrompt({ swarm: { ...context.swarm, prompt: context.run.prompt }, roles: outputs }),
      signal,
    })
  }).pipe(Effect.provideService(InstanceRef, context.instance))
})

    return SwarmExecution.of({ executeOrchestrator, executeWorker, executeSynthesis, cancelSessionTree })
  }),
)
