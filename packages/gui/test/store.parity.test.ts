import { describe, expect, test } from "bun:test"
import type { GuiClient } from "../src/renderer/src/lib/client"
import { prepareSessionPromptTarget } from "../src/renderer/src/lib/session-prompt"
import {
  createProject,
  createSession,
  createSwarm,
  createView,
  deleteProject,
  deleteSession,
  loadSession,
  loadSessionCards,
  loadSnapshot,
  moveSession,
  renameProject,
  renameSession,
  runSessionCommand,
  runShellCommand,
  sendPrompt,
  updateProject,
  updateProjectFolders,
  validateProjectFolders,
} from "../src/renderer/src/lib/store"

describe("GUI store backend parity", () => {
  test("loads and merges session sources", async () => {
    const calls: string[] = []
    const gui = fakeGui(calls)
    const snapshot = await loadSnapshot(gui)

    expect(calls).toEqual(expect.arrayContaining([
      "project.current",
      "opencodex.session.sync",
      "config.providers",
      "app.agents",
      "swarm.list",
      "job.list",
    ]))
    expect(calls).not.toContain("project.list")
    expect(calls).not.toContain("session.list")
    expect(calls).not.toContain("session.status")
    expect(calls).not.toContain("permission.list")
    expect(calls).not.toContain("question.list")
    expect(calls).not.toContain("view.list")
    expect(calls).not.toContain("session.messages:session-list")
    expect(snapshot.sessions.map((session) => session.id)).toEqual(["project-session", "session-list"])
    expect(snapshot.permissions).toHaveLength(1)
    expect(snapshot.questions).toHaveLength(1)
    expect(snapshot.sessionUiState["session-list"]?.displayStatus).toBe("input_needed")
    expect(snapshot.providers[0]?.id).toBe("anthropic")
    expect(snapshot.agents[0]?.name).toBe("build")
  })

  test("loads lightweight session card state without session content", async () => {
    const calls: string[] = []
    const gui = fakeGui(calls)
    const cards = await loadSessionCards(gui)

    expect(calls).toContain("opencodex.session.sync")
    expect(calls.filter((call) => call === "opencodex.session.sync")).toHaveLength(1)
    expect(calls).not.toContain("project.list")
    expect(calls).not.toContain("session.list")
    expect(calls).not.toContain("session.status")
    expect(calls).not.toContain("permission.list")
    expect(calls).not.toContain("question.list")
    expect(calls).not.toContain("session.messages:session-list")
    expect(calls).not.toContain("config.providers")
    expect(calls).not.toContain("app.agents")
    expect(calls).not.toContain("job.list")
    expect(calls).not.toContain("view.list")
    expect(cards.changed).toBe(true)
    if (cards.changed) {
      expect(cards.snapshot.sessions.map((session) => session.id)).toEqual(["project-session", "session-list"])
      expect(cards.snapshot.sessionUiState["session-list"]?.updated).toBe(true)
    }
  })

  test("keeps view-only sessions on views without expanding the scoped session index", async () => {
    const calls: string[] = []
    const viewOnlySession = session("view-only-session", 3)
    const cards = await loadSessionCards(fakeGui(calls, { viewSessions: [viewOnlySession] }))

    expect(cards.changed).toBe(true)
    if (cards.changed) {
      expect(cards.snapshot.views[0]?.sessionIDs).toEqual(["view-only-session"])
      expect(cards.snapshot.views[0]?.sessions.map((item) => item.id)).toEqual(["view-only-session"])
      expect(cards.snapshot.sessions.map((item) => item.id)).not.toContain("view-only-session")
    }
  })

  test("skips unchanged lightweight session sync revisions", async () => {
    const calls: string[] = []
    const gui = fakeGui(calls)

    const cards = await loadSessionCards(gui, "rev-1")

    expect(calls).toContain("opencodex.session.sync:rev-1")
    expect(cards).toEqual({ changed: false, revision: "rev-1" })
    expect(calls).not.toContain("session.messages:session-list")
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
    expect(calls.find((call) => call.startsWith("session.promptAsync.messageID:"))).toMatch(/^session\.promptAsync\.messageID:msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/)
  })

  test("sends server command and shell payloads through TUI-equivalent APIs", async () => {
    const calls: string[] = []
    const gui = fakeGui(calls)

    await runSessionCommand(gui, "session-list", {
      command: "review",
      arguments: "staged changes",
      agent: "build",
      model: { providerID: "anthropic", modelID: "claude-sonnet" },
      variant: "fast",
      parts: [
        { type: "text", text: "/review staged changes" },
        { type: "file", mime: "text/plain", filename: "src/app.ts", url: "file:///src/app.ts" },
      ],
    })
    await runShellCommand(gui, "session-list", {
      command: "bun test",
      agent: "build",
      model: { providerID: "anthropic", modelID: "claude-sonnet" },
    })

    expect(calls).toContain("session.command:session-list:review:staged changes:build:anthropic/claude-sonnet:fast:1")
    expect(calls.find((call) => call.startsWith("session.command.messageID:"))).toMatch(/^session\.command\.messageID:msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/)
    expect(calls).toContain("session.shell:session-list:bun test:build:anthropic/claude-sonnet")
    expect(calls.find((call) => call.startsWith("session.shell.messageID:"))).toMatch(/^session\.shell\.messageID:msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/)
  })

  test("prepares prompt targets for existing and pending sessions", async () => {
    const calls: string[] = []
    const gui = fakeGui(calls)
    const existing = session("existing-session", 1)

    expect(await prepareSessionPromptTarget(gui, { name: "session" }, existing)).toEqual({ target: existing })

    const pending = await prepareSessionPromptTarget(gui, { name: "new-session", projectID: "project-1" }, session("pending-session", 2))

    expect(calls).toContain("opencodex.session.create:project-1")
    expect(pending.target.id).toBe("session-list")
    expect(pending.createdSessionID).toBe("session-list")
  })

  test("loads TUI-style session bundle", async () => {
    const calls: string[] = []
    const gui = fakeGui(calls)
    const data = await loadSession(gui, "session-list")

    expect(calls).toContain("session.messages:session-list")
    expect(calls).toContain("session.messages.limit:201")
    expect(calls).toContain("session.todo:session-list")
    expect(calls).toContain("session.diff:session-list")
    expect(data.messages).toHaveLength(1)
    expect(data.messages[0]?.parts[0]).toMatchObject({ type: "text", text: "hello" })
    expect(data.todos[0].content).toBe("Ship GUI")
    expect(data.diffs[0].file).toBe("packages/gui/src/renderer/src/app.tsx")
  })

  test("loads lightweight view session bundle", async () => {
    const calls: string[] = []
    const gui = fakeGui(calls)
    const data = await loadSession(gui, "session-list", undefined, { messageLimit: 48, includeSideData: false })

    expect(calls).toContain("session.messages:session-list")
    expect(calls).toContain("session.messages.limit:49")
    expect(calls).not.toContain("session.todo:session-list")
    expect(calls).not.toContain("session.diff:session-list")
    expect(data.messages).toHaveLength(1)
    expect(data.todos).toHaveLength(0)
    expect(data.diffs).toHaveLength(0)
  })

  test("loads budgeted session messages without extra count overfetch", async () => {
    const calls: string[] = []
    const gui = fakeGui(calls)
    const data = await loadSession(gui, "session-list", undefined, { messageLimit: 96, messageRenderBudget: 28_000, includeSideData: false })

    expect(calls).toContain("session.messages:session-list")
    expect(calls).toContain("session.messages.limit:96")
    expect(calls).toContain("session.messages.renderBudget:28000")
    expect(calls).not.toContain("session.messages.limit:97")
    expect(data.messages).toHaveLength(1)
  })

  test("loads paged session messages with cursor", async () => {
    const calls: string[] = []
    const gui = fakeGui(calls)
    const data = await loadSession(gui, "session-list", undefined, { messageLimit: 48, messageRenderBudget: 14_000, messageBefore: "cursor-1", includeSideData: false })

    expect(calls).toContain("session.messages.limit:48")
    expect(calls).toContain("session.messages.renderBudget:14000")
    expect(calls).toContain("session.messages.before:cursor-1")
    expect(data.messageCursor).toBe("next-cursor")
  })

  test("synthesizes cursor when a page has more messages than the rendered limit", async () => {
    const calls: string[] = []
    const gui = fakeGui(calls, {
      headerCursor: null,
      messages: {
        "session-list": [message("m1", 1), message("m2", 2), message("m3", 3)],
      },
    })
    const data = await loadSession(gui, "session-list", undefined, { messageLimit: 2, includeSideData: false })

    expect(calls).toContain("session.messages.limit:3")
    expect(data.messages.map((item) => item.info.id)).toEqual(["m2", "m3"])
    expect(data.messageCursor).toBeTruthy()
  })

  test("does not infer running when backend status is idle or omitted", async () => {
    const now = Date.now()
    const calls: string[] = []
    const gui = fakeGui(calls, {
      sessionStatus: {},
      updated: now,
      messages: {
        "session-list": [
          {
            info: { id: "assistant-old", sessionID: "session-list", role: "assistant", time: { created: now - 2_000 } },
            parts: [{ type: "step-start" }],
          },
          {
            info: { id: "assistant-new", sessionID: "session-list", role: "assistant", finish: "stop", time: { created: now - 1_000, completed: now } },
            parts: [{ type: "step-start" }, { type: "step-finish" }],
          },
        ],
      },
    })

    const snapshot = await loadSnapshot(gui)

    expect(snapshot.sessionStatus["session-list"]).toBeUndefined()
  })

  test("uses backend busy status as authoritative", async () => {
    const now = Date.now()
    const calls: string[] = []
    const gui = fakeGui(calls, {
      sessionStatus: { "session-list": { type: "busy" } },
      updated: now,
    })

    const snapshot = await loadSnapshot(gui)

    expect(snapshot.sessionStatus["session-list"]).toEqual({ type: "busy" })
  })

  test("sends project/session CRUD payloads through existing APIs", async () => {
    const calls: string[] = []
    const gui = fakeGui(calls)

    await validateProjectFolders(gui, { projectID: "project-1", folders: ["C:/Work/OpencodeX"] })
    await renameProject(gui, "project-1", "Renamed")
    await updateProjectFolders(gui, "project-1", ["C:/Work/OpencodeX"])
    await updateProject(gui, "project-1", { name: "Renamed", folders: ["C:/Work/One", "C:/Work/Two"] })
    await deleteProject(gui, "project-1")
    await renameSession(gui, "session-list", "Renamed Session")
    await moveSession(gui, "session-list", "project-1")
    await deleteSession(gui, "session-list")

    expect(calls).toContain("project.validate:project-1:C:/Work/OpencodeX")
    expect(calls).toContain("project.update:project-1:Renamed:")
    expect(calls).toContain("project.update:project-1::C:/Work/OpencodeX")
    expect(calls).toContain("project.update:project-1:Renamed:C:/Work/One,C:/Work/Two")
    expect(calls).toContain("project.delete:project-1")
    expect(calls).toContain("session.update:session-list:Renamed Session")
    expect(calls).toContain("opencodex.session.move:session-list:project-1")
    expect(calls).toContain("opencodex.session.delete:session-list")
  })
})

function fakeGui(calls: string[], options: { sessionStatus?: Record<string, unknown>; sessionUiState?: Record<string, unknown>; messages?: Record<string, unknown[]>; updated?: number; headerCursor?: string | null; viewSessions?: ReturnType<typeof session>[] } = {}) {
  const sessionList = session("session-list", options.updated ?? 1)
  const projectSession = session("project-session", options.updated ?? 2)
  const viewSessions = options.viewSessions ?? []
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
          sync: async (input?: { since?: string }) => {
            calls.push("opencodex.session.sync")
            calls.push(`opencodex.session.sync:${input?.since ?? ""}`)
            if (input?.since === "rev-1") return { data: { changed: false, revision: "rev-1" } }
            return {
              data: {
                changed: true,
                revision: "rev-1",
                snapshot: {
                  projects: [
                    {
                      id: "project-1",
                      name: "Project",
                      project: { id: "project-core", name: "Project", time: { created: 1, updated: 1 } },
                      folders: [{ path: "C:/Work/OpencodeX" }],
                      sessions: [projectSession],
                    },
                  ],
                  sessions: [projectSession, sessionList],
                  views: viewSessions.length > 0
                    ? [{
                      id: "view-1",
                      title: "View",
                      focusedSessionID: viewSessions[0]?.id,
                      layout: "auto",
                      sessions: viewSessions,
                      sessionIDs: viewSessions.map((item) => item.id),
                      timeCreated: 1,
                      timeUpdated: 1,
                    }]
                    : [],
                  sessionStatus: options.sessionStatus ?? { "session-list": { type: "idle" } },
                  permissions: [
                    {
                      id: "permission-1",
                      sessionID: "session-list",
                      permission: "edit",
                      patterns: ["**/*.ts"],
                      metadata: {},
                      always: [],
                    },
                  ],
                  questions: [
                    {
                      id: "question-1",
                      sessionID: "session-list",
                      questions: [{ header: "Choice", question: "Pick one", options: [{ label: "A", description: "Option A" }] }],
                    },
                  ],
                  sessionUiState: {
                    "session-list": {
                      sessionID: "session-list",
                      reviewedFiles: [],
                      displayStatus: "input_needed",
                      updated: true,
                    },
                    "project-session": {
                      sessionID: "project-session",
                      reviewedFiles: [],
                      displayStatus: "needs_review",
                      updated: true,
                    },
                    ...options.sessionUiState,
                  },
                },
              },
            }
          },
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
      experimental: { workspace: { status: async () => ({ data: [] }) } },
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
        status: async (input?: { workspace?: string }) => {
          calls.push("session.status")
          calls.push(`session.status.workspace:${input?.workspace ?? ""}`)
          return { data: options.sessionStatus ?? { "session-list": { type: "idle" } } }
        },
        promptAsync: async (input: { sessionID: string; messageID?: string; agent?: string; model?: { providerID: string; modelID: string }; variant?: string; parts?: Array<{ type: string; text?: string }> }) => {
          calls.push(`session.promptAsync:${input.sessionID}:${input.parts?.[0]?.text}:${input.agent ?? ""}:${input.model ? `${input.model.providerID}/${input.model.modelID}` : ""}:${input.variant ?? ""}`)
          calls.push(`session.promptAsync.messageID:${input.messageID ?? ""}`)
          return { data: true }
        },
        command: async (input: { sessionID: string; messageID?: string; command: string; arguments: string; agent?: string; model?: string; variant?: string; parts?: Array<{ type: string }> }) => {
          calls.push(`session.command:${input.sessionID}:${input.command}:${input.arguments}:${input.agent ?? ""}:${input.model ?? ""}:${input.variant ?? ""}:${input.parts?.length ?? 0}`)
          calls.push(`session.command.messageID:${input.messageID ?? ""}`)
          return { data: true }
        },
        shell: async (input: { sessionID: string; messageID?: string; command: string; agent?: string; model?: { providerID: string; modelID: string } }) => {
          calls.push(`session.shell:${input.sessionID}:${input.command}:${input.agent ?? ""}:${input.model ? `${input.model.providerID}/${input.model.modelID}` : ""}`)
          calls.push(`session.shell.messageID:${input.messageID ?? ""}`)
          return { data: true }
        },
        messages: async (input: { sessionID: string; limit?: number; renderBudget?: number; before?: string }) => {
          calls.push(`session.messages:${input.sessionID}`)
          calls.push(`session.messages.limit:${input.limit ?? ""}`)
          calls.push(`session.messages.renderBudget:${input.renderBudget ?? ""}`)
          calls.push(`session.messages.before:${input.before ?? ""}`)
          const response = { headers: { get: (name: string) => name.toLowerCase() === "x-next-cursor" ? options.headerCursor === undefined ? "next-cursor" : options.headerCursor : null } }
          if (options.messages?.[input.sessionID]) return { data: options.messages[input.sessionID], response }
          return { data: [{ info: sessionList, parts: [{ id: "part-1", sessionID: input.sessionID, messageID: sessionList.id, type: "text", text: JSON.stringify({ final: "hello" }) }] }], response }
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

function message(id: string, created: number) {
  return {
    info: { id, sessionID: "session-list", role: "user", time: { created } },
    parts: [],
  }
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
