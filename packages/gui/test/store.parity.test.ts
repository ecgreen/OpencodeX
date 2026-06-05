import { describe, expect, test } from "bun:test"
import type { GuiClient } from "../src/renderer/src/lib/client"
import {
  createProject,
  createSession,
  createSwarm,
  createView,
  deleteProject,
  deleteSession,
  loadSession,
  loadSnapshot,
  moveSession,
  renameProject,
  renameSession,
  sendPrompt,
  updateProjectFolders,
  validateProjectFolders,
} from "../src/renderer/src/lib/store"

describe("GUI store backend parity", () => {
  test("loads and merges session sources", async () => {
    const calls: string[] = []
    const gui = fakeGui(calls)
    const snapshot = await loadSnapshot(gui)

    expect(calls).toContain("permission.list")
    expect(calls).toContain("question.list")
    expect(calls.slice(0, 9)).toEqual([
      "project.current",
      "project.list",
      "session.list",
      "config.providers",
      "app.agents",
      "swarm.list",
      "job.list",
      "view.list",
      "session.status",
    ])
    expect(snapshot.sessions.map((session) => session.id)).toEqual(["project-session", "session-list"])
    expect(snapshot.permissions).toHaveLength(1)
    expect(snapshot.questions).toHaveLength(1)
    expect(snapshot.providers[0]?.id).toBe("anthropic")
    expect(snapshot.agents[0]?.name).toBe("build")
  })

  test("sends create and prompt payloads through existing APIs", async () => {
    const calls: string[] = []
    const gui = fakeGui(calls)

    await createProject(gui, { name: "QA", directory: "C:/Work/OpencodeX" })
    await createSession(gui, { projectID: "project-1", directory: "C:/Work/OpencodeX", title: "QA Session" })
    await createSwarm(gui, { projectID: "project-1", title: "QA Swarm", prompt: "Test" })
    await createView(gui, { title: "QA View", sessionIDs: ["session-list"] })
    await sendPrompt(gui, "session-list", "hello", {
      agent: "build",
      model: { providerID: "anthropic", modelID: "claude-sonnet" },
      variant: "fast",
    })

    expect(calls).toContain("project.create:C:/Work/OpencodeX")
    expect(calls).toContain("opencodex.session.create:project-1")
    expect(calls).toContain("swarm.create:project-1")
    expect(calls).toContain("view.create:session-list")
    expect(calls).toContain("session.promptAsync:session-list:hello:build:anthropic/claude-sonnet:fast")
  })

  test("loads TUI-style session bundle", async () => {
    const calls: string[] = []
    const gui = fakeGui(calls)
    const data = await loadSession(gui, "session-list")

    expect(calls).toContain("session.messages:session-list")
    expect(calls).toContain("session.todo:session-list")
    expect(calls).toContain("session.diff:session-list")
    expect(data.messages).toHaveLength(1)
    expect(data.messages[0]?.parts[0]).toMatchObject({ type: "text", text: "hello" })
    expect(data.todos[0].content).toBe("Ship GUI")
    expect(data.diffs[0].file).toBe("packages/gui/src/renderer/src/app.tsx")
  })

  test("sends project/session CRUD payloads through existing APIs", async () => {
    const calls: string[] = []
    const gui = fakeGui(calls)

    await validateProjectFolders(gui, { projectID: "project-1", folders: ["C:/Work/OpencodeX"] })
    await renameProject(gui, "project-1", "Renamed")
    await updateProjectFolders(gui, "project-1", ["C:/Work/OpencodeX"])
    await deleteProject(gui, "project-1")
    await renameSession(gui, "session-list", "Renamed Session")
    await moveSession(gui, "session-list", "project-1")
    await deleteSession(gui, "session-list")

    expect(calls).toContain("project.validate:project-1:C:/Work/OpencodeX")
    expect(calls).toContain("project.update:project-1:Renamed:")
    expect(calls).toContain("project.update:project-1::C:/Work/OpencodeX")
    expect(calls).toContain("project.delete:project-1")
    expect(calls).toContain("session.update:session-list:Renamed Session")
    expect(calls).toContain("opencodex.session.move:session-list:project-1")
    expect(calls).toContain("opencodex.session.delete:session-list")
  })
})

function fakeGui(calls: string[]) {
  const sessionList = session("session-list", 1)
  const projectSession = session("project-session", 2)
  return {
    directory: "C:/Work/OpencodeX",
    url: "http://127.0.0.1:4096",
    authHeader: "",
    client: {
      opencodex: {
        project: {
          list: async () => {
            calls.push("project.list")
            return {
              data: [
                {
                  id: "project-1",
                  name: "Project",
                  project: { id: "project-core", name: "Project", time: { created: 1, updated: 1 } },
                  folders: [{ path: "C:/Work/OpencodeX" }],
                  sessions: [projectSession],
                },
              ],
            }
          },
          create: async (input: { opencodeXProjectCreateInput?: { directory?: string } }) => {
            calls.push(`project.create:${input.opencodeXProjectCreateInput?.directory}`)
            return { data: undefined }
          },
          validate: async (input: { opencodeXProjectValidateInput?: { projectID?: string; folders: string[] } }) => {
            calls.push(`project.validate:${input.opencodeXProjectValidateInput?.projectID}:${input.opencodeXProjectValidateInput?.folders.join(",")}`)
            return { data: { valid: true, folders: [] } }
          },
          update: async (input: { projectID: string; name?: string; folders?: string[] }) => {
            calls.push(`project.update:${input.projectID}:${input.name ?? ""}:${input.folders?.join(",") ?? ""}`)
            return { data: undefined }
          },
          delete: async (input: { projectID: string }) => {
            calls.push(`project.delete:${input.projectID}`)
            return { data: true }
          },
        },
        session: {
          create: async (input: { opencodeXSessionCreateInput?: { projectID?: string } }) => {
            calls.push(`opencodex.session.create:${input.opencodeXSessionCreateInput?.projectID}`)
            return { data: sessionList }
          },
          move: async (input: { opencodeXSessionMoveInput?: { sessionID: string; projectID: string } }) => {
            calls.push(`opencodex.session.move:${input.opencodeXSessionMoveInput?.sessionID}:${input.opencodeXSessionMoveInput?.projectID}`)
            return { data: sessionList }
          },
          delete: async (input: { sessionID: string }) => {
            calls.push(`opencodex.session.delete:${input.sessionID}`)
            return { data: true }
          },
        },
        swarm: {
          list: async () => {
            calls.push("swarm.list")
            return { data: [] }
          },
          create: async (input: { opencodeXSwarmCreateInput?: { projectID?: string } }) => {
            calls.push(`swarm.create:${input.opencodeXSwarmCreateInput?.projectID}`)
            return { data: undefined }
          },
        },
        job: {
          list: async () => {
            calls.push("job.list")
            return { data: [] }
          },
        },
        view: {
          list: async () => {
            calls.push("view.list")
            return { data: [] }
          },
          create: async (input: { opencodeXViewCreateInput?: { sessionIDs: string[] } }) => {
            calls.push(`view.create:${input.opencodeXViewCreateInput?.sessionIDs.join(",")}`)
            return { data: undefined }
          },
        },
      },
      config: {
        providers: async () => {
          calls.push("config.providers")
          return {
            data: {
              default: {},
              providers: [
                {
                  id: "anthropic",
                  name: "Anthropic",
                  source: "api",
                  env: [],
                  options: {},
                  models: {
                    "claude-sonnet": {
                      id: "claude-sonnet",
                      providerID: "anthropic",
                      name: "Claude Sonnet",
                      status: "active",
                      release_date: "2026-01-01",
                      api: { id: "claude-sonnet", url: "", npm: "" },
                      capabilities: {
                        temperature: true,
                        reasoning: true,
                        attachment: true,
                        toolcall: true,
                        input: { text: true, audio: false, image: true, video: false, pdf: true },
                        output: { text: true, audio: false, image: false, video: false, pdf: false },
                        interleaved: false,
                      },
                      cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
                      limit: { context: 200000, output: 8192 },
                      options: {},
                      headers: {},
                      variants: { fast: {} },
                    },
                  },
                },
              ],
            },
          }
        },
      },
      app: {
        agents: async () => {
          calls.push("app.agents")
          return {
            data: [
              {
                name: "build",
                mode: "primary",
                native: true,
                permission: {},
                options: {},
              },
            ],
          }
        },
      },
      project: {
        current: async () => {
          calls.push("project.current")
          return { data: { id: "project-core", name: "Project", worktree: "C:/Work/OpencodeX", time: { created: 1, updated: 1 } } }
        },
      },
      session: {
        list: async () => {
          calls.push("session.list")
          return { data: [sessionList] }
        },
        status: async () => {
          calls.push("session.status")
          return { data: { "session-list": { type: "idle" } } }
        },
        promptAsync: async (input: { sessionID: string; agent?: string; model?: { providerID: string; modelID: string }; variant?: string; parts?: Array<{ type: string; text?: string }> }) => {
          calls.push(`session.promptAsync:${input.sessionID}:${input.parts?.[0]?.text}:${input.agent ?? ""}:${input.model ? `${input.model.providerID}/${input.model.modelID}` : ""}:${input.variant ?? ""}`)
          return { data: true }
        },
        messages: async (input: { sessionID: string }) => {
          calls.push(`session.messages:${input.sessionID}`)
          return { data: [{ info: sessionList, parts: [{ id: "part-1", sessionID: input.sessionID, messageID: sessionList.id, type: "text", text: JSON.stringify({ final: "hello" }) }] }] }
        },
        todo: async (input: { sessionID: string }) => {
          calls.push(`session.todo:${input.sessionID}`)
          return { data: [{ content: "Ship GUI", status: "in_progress", priority: "high" }] }
        },
        diff: async (input: { sessionID: string }) => {
          calls.push(`session.diff:${input.sessionID}`)
          return { data: [{ file: "packages/gui/src/renderer/src/app.tsx", additions: 1, deletions: 0, status: "modified" }] }
        },
        update: async (input: { sessionID: string; title?: string }) => {
          calls.push(`session.update:${input.sessionID}:${input.title}`)
          return { data: sessionList }
        },
      },
      permission: {
        list: async () => {
          calls.push("permission.list")
          return {
            data: [
              {
                id: "permission-1",
                sessionID: "session-list",
                permission: "edit",
                patterns: ["**/*.ts"],
                metadata: {},
                always: [],
              },
            ],
          }
        },
      },
      question: {
        list: async () => {
          calls.push("question.list")
          return {
            data: [
              {
                id: "question-1",
                sessionID: "session-list",
                questions: [{ header: "Choice", question: "Pick one", options: [{ label: "A", description: "Option A" }] }],
              },
            ],
          }
        },
      },
    },
  } as unknown as GuiClient
}

function session(id: string, updated: number) {
  return {
    id,
    slug: id,
    projectID: "project-core",
    directory: "C:/Work/OpencodeX",
    title: id,
    version: "test",
    time: { created: updated, updated },
    project: null,
  }
}
