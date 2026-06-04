import type {
  GlobalEvent,
  Message,
  OpencodeXJob,
  OpencodeXProject,
  OpencodeXSwarm,
  OpencodeXView,
  Part,
  Session,
  SessionStatus,
} from "@opencode-ai/sdk/v2/client"
import type { GuiClient } from "./client"

export type MessageBundle = {
  info: Message
  parts: Part[]
}

export type GuiSnapshot = {
  projects: OpencodeXProject[]
  sessions: Session[]
  sessionStatus: Record<string, SessionStatus>
  swarms: OpencodeXSwarm[]
  jobs: OpencodeXJob[]
  views: OpencodeXView[]
}

export async function loadSnapshot(gui: GuiClient): Promise<GuiSnapshot> {
  const since = Date.now() - 30 * 24 * 60 * 60 * 1000
  const [projects, sessions, sessionStatus, swarms, jobs, views] = await Promise.all([
    gui.client.opencodex.project.list().then((x) => x.data ?? []),
    gui.client.session.list({ start: since }).then((x) => x.data ?? []),
    gui.client.session.status().then((x) => x.data ?? {}),
    gui.client.opencodex.swarm.list().then((x) => x.data ?? []),
    gui.client.opencodex.job.list().then((x) => x.data ?? []),
    gui.client.opencodex.view.list().then((x) => x.data ?? []),
  ])

  return { projects, sessions, sessionStatus, swarms, jobs, views }
}

export async function loadSession(gui: GuiClient, sessionID: string): Promise<MessageBundle[]> {
  const response = await gui.client.session.messages({ sessionID, limit: 200 })
  return (response.data ?? []) as MessageBundle[]
}

export async function sendPrompt(gui: GuiClient, sessionID: string, text: string) {
  return gui.client.session.promptAsync({
    sessionID,
    messageID: crypto.randomUUID(),
    parts: [{ type: "text", text }],
  })
}

export function subscribeEvents(gui: GuiClient, onEvent: (event: GlobalEvent) => void) {
  const controller = new AbortController()
  void (async () => {
    while (!controller.signal.aborted) {
      try {
        const events = await gui.client.global.event({ signal: controller.signal, sseMaxRetryAttempts: 0 })
        for await (const event of events.stream) {
          if (controller.signal.aborted) break
          onEvent(event)
        }
      } catch {
        if (controller.signal.aborted) break
        await new Promise((resolve) => setTimeout(resolve, 1_000))
      }
    }
  })()
  return () => controller.abort()
}
