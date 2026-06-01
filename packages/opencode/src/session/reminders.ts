import path from "path"
import { SessionLegacy } from "@opencode-ai/core/session/legacy"
import { Effect } from "effect"
import { Agent } from "@/agent/agent"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Database } from "@opencode-ai/core/database/database"
import { InstanceState } from "@/effect/instance-state"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { PartID } from "./schema"
import { MessageV2 } from "./message-v2"
import * as Session from "./session"
import { OpencodeXProjectFolder } from "@/opencodex/project-folder"
import PROMPT_PLAN from "./prompt/plan.txt"
import BUILD_SWITCH from "./prompt/build-switch.txt"
import PLAN_MODE from "./prompt/plan-mode.txt"

function opencodexContextText(session: Session.Info, value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return
  const projectID = "projectID" in value && typeof value.projectID === "string" ? value.projectID : undefined
  const name = "name" in value && typeof value.name === "string" ? value.name : undefined
  const folders =
    "folders" in value && Array.isArray(value.folders)
      ? value.folders.filter((folder): folder is string => typeof folder === "string" && folder.length > 0)
      : []
  if (!projectID && folders.length === 0) return
  return [
    "<system-reminder>",
    "This session is attached to an OpencodeX project.",
    ...(name ? [`Project name: ${name}`] : []),
    ...(projectID ? [`Project ID: ${projectID}`] : []),
    `Session working directory: ${session.directory}`,
    ...(folders.length > 0
      ? [
          "Project folder roots. Prefer these roots when searching, reading, or modifying project files:",
          ...folders.map((folder) => `- ${folder}`),
        ]
      : []),
    "If the user asks what project or files you are working with, use this OpencodeX project context.",
    "</system-reminder>",
  ].join("\n")
}

const opencodexContext = Effect.fn("SessionReminders.opencodexContext")(function* (session: Session.Info) {
  const saved = opencodexContextText(session, session.metadata?.opencodex)
  if (saved) return saved

  const { db } = yield* Database.Service
  const row = yield* OpencodeXProjectFolder.getSessionProject(db, session.id)
  if (!row) return
  const project = yield* OpencodeXProjectFolder.getProject(db, row.opencodex_project_id)
  if (!project) return
  const folders = yield* OpencodeXProjectFolder.listFolders(db, row.opencodex_project_id)
  return opencodexContextText(session, {
    projectID: row.opencodex_project_id,
    ...(project.name ? { name: project.name } : {}),
    folders: folders.map((folder) => folder.path),
  })
})

export const apply = Effect.fn("SessionReminders.apply")(function* (input: {
  messages: SessionLegacy.WithParts[]
  agent: Agent.Info
  session: Session.Info
}) {
  const flags = yield* RuntimeFlags.Service
  const fsys = yield* AppFileSystem.Service
  const sessions = yield* Session.Service
  const userMessage = input.messages.findLast((msg) => msg.info.role === "user")
  if (!userMessage) return input.messages
  const context = yield* opencodexContext(input.session)
  if (context) {
    userMessage.parts.push({
      id: PartID.ascending(),
      messageID: userMessage.info.id,
      sessionID: userMessage.info.sessionID,
      type: "text",
      text: context,
      synthetic: true,
    })
  }

  if (!flags.experimentalPlanMode) {
    if (input.agent.name === "plan") {
      userMessage.parts.push({
        id: PartID.ascending(),
        messageID: userMessage.info.id,
        sessionID: userMessage.info.sessionID,
        type: "text",
        text: PROMPT_PLAN,
        synthetic: true,
      })
    }
    const wasPlan = input.messages.some((msg) => msg.info.role === "assistant" && msg.info.agent === "plan")
    if (wasPlan && input.agent.name === "build") {
      userMessage.parts.push({
        id: PartID.ascending(),
        messageID: userMessage.info.id,
        sessionID: userMessage.info.sessionID,
        type: "text",
        text: BUILD_SWITCH,
        synthetic: true,
      })
    }
    return input.messages
  }

  const assistantMessage = input.messages.findLast((msg) => msg.info.role === "assistant")
  if (input.agent.name !== "plan" && assistantMessage?.info.agent === "plan") {
    const ctx = yield* InstanceState.context
    const plan = Session.plan(input.session, ctx)
    const exists = yield* fsys.existsSafe(plan)
    const part = yield* sessions.updatePart({
      id: PartID.ascending(),
      messageID: userMessage.info.id,
      sessionID: userMessage.info.sessionID,
      type: "text",
      text: exists
        ? `${BUILD_SWITCH}\n\nA plan file exists at ${plan}. You should execute on the plan defined within it`
        : BUILD_SWITCH,
      synthetic: true,
    })
    userMessage.parts.push(part)
    return input.messages
  }

  if (input.agent.name !== "plan" || assistantMessage?.info.agent === "plan") return input.messages

  const ctx = yield* InstanceState.context
  const plan = Session.plan(input.session, ctx)
  const exists = yield* fsys.existsSafe(plan)
  if (!exists) yield* fsys.ensureDir(path.dirname(plan)).pipe(Effect.catch(Effect.die))
  const part = yield* sessions.updatePart({
    id: PartID.ascending(),
    messageID: userMessage.info.id,
    sessionID: userMessage.info.sessionID,
    type: "text",
    text: PLAN_MODE.replace("${planInfo}", () =>
      exists
        ? `A plan file already exists at ${plan}. You can read it and make incremental edits using the edit tool.`
        : `No plan file exists yet. You should create your plan at ${plan} using the write tool.`,
    ),
    synthetic: true,
  })
  userMessage.parts.push(part)
  return input.messages
})

export * as SessionReminders from "./reminders"
