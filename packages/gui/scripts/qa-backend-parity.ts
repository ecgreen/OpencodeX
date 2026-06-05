import fs from "node:fs"
import path from "node:path"
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import { createProject, createSession, createSwarm, createView, loadSnapshot } from "../src/renderer/src/lib/store"
import type { GuiClient } from "../src/renderer/src/lib/client"

const url = process.env.OPENCODEX_GUI_QA_URL ?? process.env.VITE_OPENCODEX_SERVER_URL
const directory = process.env.OPENCODEX_GUI_QA_DIRECTORY ?? process.env.VITE_OPENCODEX_DIRECTORY ?? process.cwd()
const username = process.env.OPENCODEX_GUI_QA_USERNAME ?? process.env.VITE_OPENCODEX_SERVER_USERNAME ?? "opencode"
const password = process.env.OPENCODEX_GUI_QA_PASSWORD ?? process.env.VITE_OPENCODEX_SERVER_PASSWORD ?? ""
const write = process.env.OPENCODEX_GUI_QA_WRITE === "1"
const artifactDir = path.resolve(import.meta.dirname, "..", ".artifacts", "gui")

if (!url) {
  console.error("Set OPENCODEX_GUI_QA_URL to an existing opencodex serve URL before running backend parity.")
  process.exit(1)
}

fs.mkdirSync(artifactDir, { recursive: true })

const authHeader = password ? `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}` : ""
const gui: GuiClient = {
  url,
  directory,
  authHeader,
  client: createOpencodeClient({
    baseUrl: url,
    directory,
    headers: authHeader ? { authorization: authHeader } : undefined,
  }),
}

const result: Record<string, unknown> = {
  url,
  directory,
  write,
  checks: [],
}

try {
  const before = await loadSnapshot(gui)
  check(result, "snapshot loads", true, {
    projects: before.projects.length,
    sessions: before.sessions.length,
    permissions: before.permissions.length,
    questions: before.questions.length,
    swarms: before.swarms.length,
    views: before.views.length,
  })

  if (write) {
    const stamp = Date.now().toString(36)
    const project = await createProject(gui, { name: `GUI QA ${stamp}`, directory })
    const projectID = project.data?.id
    check(result, "project create returns id", !!projectID, { projectID })

    if (projectID) {
      const session = await createSession(gui, { projectID, directory, title: `GUI QA Session ${stamp}` })
      const sessionID = session.data?.id
      check(result, "project session create returns id", !!sessionID, { sessionID })
      await createSwarm(gui, { projectID, title: `GUI QA Swarm ${stamp}`, prompt: "QA parity smoke" })
      check(result, "swarm create completed", true)
      if (sessionID) {
        await createView(gui, { title: `GUI QA View ${stamp}`, sessionIDs: [sessionID] })
        check(result, "view create completed", true)
      }
    } else {
      throw new Error("Project create did not return an id")
    }
  }

  const after = await loadSnapshot(gui)
  check(result, "post-check snapshot loads", true, {
    projects: after.projects.length,
    sessions: after.sessions.length,
    swarms: after.swarms.length,
    views: after.views.length,
  })
  fs.writeFileSync(path.join(artifactDir, "backend-parity.json"), JSON.stringify(result, null, 2))
} catch (error) {
  check(result, "backend parity failed", false, { error: error instanceof Error ? error.message : String(error) })
  fs.writeFileSync(path.join(artifactDir, "backend-parity.json"), JSON.stringify(result, null, 2))
  process.exit(1)
}

function check(target: Record<string, unknown>, name: string, pass: boolean, details: Record<string, unknown> = {}) {
  ;(target.checks as unknown[]).push({ name, pass, details })
  console.log(`${pass ? "PASS" : "FAIL"} ${name}`)
}
