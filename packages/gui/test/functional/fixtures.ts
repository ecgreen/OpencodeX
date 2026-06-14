import type { Agent, Command, OpencodeXProject, OpencodeXView, Part, PermissionRequest, Provider, QuestionRequest, Session } from "@opencode-ai/sdk/v2/client"
import type { GuiClient } from "../../src/renderer/src/lib/client"
import type { MessageBundle, SessionData } from "../../src/renderer/src/lib/store"

export function gui(directory = "C:/Work/OpencodeX"): GuiClient {
  return { directory } as GuiClient
}

export function session(id: string, input: Partial<Session> = {}): Session {
  return {
    id,
    title: id,
    directory: "C:/Work/OpencodeX",
    time: { created: 1_700_000_000_000, updated: 1_700_000_100_000 },
    cost: 0,
    ...input,
  } as Session
}

export function project(input: Partial<OpencodeXProject> = {}): OpencodeXProject {
  return {
    id: "project-1",
    name: "Project",
    folders: [{ path: "C:/Work/OpencodeX" }],
    sessions: [],
    time: { created: 1, updated: 1 },
    ...input,
  } as OpencodeXProject
}

export function view(input: Partial<OpencodeXView> = {}): OpencodeXView {
  return {
    id: "view-1",
    title: "View",
    sessionIDs: ["session-1"],
    metadata: {},
    time: { created: 1, updated: 1 },
    ...input,
  } as OpencodeXView
}

export function provider(): Provider {
  return {
    id: "anthropic",
    name: "Anthropic",
    models: {
      "claude-sonnet": {
        id: "claude-sonnet",
        name: "Claude Sonnet",
        variants: { fast: {}, slow: {} },
      },
    },
  } as Provider
}

export function agent(input: Partial<Agent> = {}): Agent {
  return {
    name: "build",
    description: "Build agent",
    mode: "primary",
    ...input,
  } as Agent
}

export function command(name: string): Command {
  return { name, source: "command", template: "", hints: [] }
}

export function sessionData(messages: MessageBundle[] = []): SessionData {
  return { messages, todos: [], diffs: [] }
}

export function userMessage(id: string, text: string): MessageBundle {
  return {
    info: {
      id,
      sessionID: "session-1",
      role: "user",
      time: { created: 1_700_000_000_000 },
    },
    parts: [textPart(id, `${id}-text`, text)],
  } as MessageBundle
}

export function assistantMessage(input: { id?: string; text?: string; reasoning?: string; tool?: boolean } = {}): MessageBundle {
  const id = input.id ?? "msg_assistant"
  return {
    info: {
      id,
      sessionID: "session-1",
      role: "assistant",
      providerID: "anthropic",
      modelID: "claude-sonnet",
      agent: "build",
      mode: "build",
      path: { cwd: "C:/Work/OpencodeX", root: "C:/Work/OpencodeX" },
      tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 1_700_000_000_100, completed: 1_700_000_001_000 },
    },
    parts: [
      textPart(id, `${id}-text`, input.text ?? "Visible answer"),
      ...(input.reasoning ? [reasoningPart(id, `${id}-reasoning`, input.reasoning)] : []),
      ...(input.tool ? [toolPart(id, `${id}-tool`)] : []),
    ],
  } as MessageBundle
}

export function textPart(messageID: string, id: string, text: string): Part {
  return {
    id,
    sessionID: "session-1",
    messageID,
    type: "text",
    text,
  } as Part
}

export function reasoningPart(messageID: string, id: string, text: string): Part {
  return {
    id,
    sessionID: "session-1",
    messageID,
    type: "reasoning",
    text,
  } as Part
}

export function toolPart(messageID: string, id: string): Part {
  return {
    id,
    sessionID: "session-1",
    messageID,
    type: "tool",
    tool: "bash",
    callID: "call_test",
    state: {
      status: "completed",
      input: { command: "echo ok" },
      output: "ok",
    },
  } as Part
}

export function permission(input: Partial<PermissionRequest> = {}): PermissionRequest {
  return {
    id: "permission-1",
    sessionID: "session-1",
    permission: "edit",
    patterns: [],
    metadata: {},
    always: [],
    ...input,
  }
}

export function question(input: Partial<QuestionRequest> = {}): QuestionRequest {
  return {
    id: "question-1",
    sessionID: "session-1",
    questions: [
      {
        header: "Confirm",
        question: "Proceed?",
        options: [{ label: "Yes", description: "Continue" }],
      },
    ],
    ...input,
  }
}
