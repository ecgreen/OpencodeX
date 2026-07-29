import type { GlobalEvent } from "@opencode-ai/sdk/v2"
import type { EventSource } from "../../src/cli/cmd/tui/context/sdk"

export const worktree = "/tmp/opencode"
export const directory = `${worktree}/packages/opencode`

export function json(data: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers)
  headers.set("content-type", "application/json")
  return new Response(JSON.stringify(data), {
    ...init,
    headers,
  })
}

export function eventSource(): EventSource {
  return { subscribe: async () => () => {} }
}

export function createEventSource() {
  let fn: ((event: GlobalEvent) => void) | undefined

  return {
    source: {
      subscribe: async (handler: (event: GlobalEvent) => void) => {
        fn = handler
        return () => {
          if (fn === handler) fn = undefined
        }
      },
    } satisfies EventSource,
    emit(event: GlobalEvent) {
      if (!fn) throw new Error("event source not ready")
      fn(event)
    },
  }
}

export type FetchHandler = (url: URL) => Response | Promise<Response> | undefined

export function createFetch(override?: FetchHandler) {
  const session = [] as URL[]
  const requests = [] as URL[]
  const requestHeaders = [] as Headers[]
  const fetch = Object.assign(
    async (...args: Parameters<typeof globalThis.fetch>) => {
      const [input, init] = args
      const url = new URL(input instanceof Request ? input.url : String(input))
      requests.push(url)
      const headers = new Headers(input instanceof Request ? input.headers : undefined)
      new Headers(init?.headers).forEach((value, key) => headers.set(key, value))
      requestHeaders.push(headers)
      if (url.pathname === "/session" || url.pathname === "/experimental/opencodex/state") session.push(url)

      const overridden = await override?.(url)
      if (overridden) return overridden

      switch (url.pathname) {
        case "/agent":
        case "/command":
        case "/experimental/opencodex/job":
        case "/experimental/opencodex/plugin":
        case "/experimental/opencodex/project":
        case "/experimental/opencodex/swarm":
        case "/experimental/opencodex/view":
        case "/experimental/workspace":
        case "/experimental/workspace/status":
        case "/formatter":
        case "/lsp":
        case "/permission":
        case "/question":
          return json([])
        case "/config":
        case "/experimental/resource":
        case "/mcp":
        case "/provider/auth":
        case "/session/status":
          return json({})
        case "/config/providers":
          return json({ providers: {}, default: {} })
        case "/path":
          return json({ home: "", state: "", config: "", worktree, directory })
        case "/project/current":
          return json({ id: "proj_test" })
        case "/provider":
          return json({ all: [], default: {}, connected: [] })
        case "/experimental/opencodex/session-sync":
          return json({
            changed: true,
            revision: "empty",
            snapshot: {
              projects: [],
              sessions: [],
              views: [],
              sessionStatus: {},
              permissions: [],
              questions: [],
              sessionUiState: {},
            },
          })
        case "/experimental/opencodex/state":
          return json({
            scope: { projectID: "proj_test", directory },
            epoch: "test-epoch",
            cursor: "test-cursor",
            digest: "empty",
            domains: {
              catalog: { revision: "empty", digest: "empty" },
              operations: { revision: "empty", digest: "empty" },
            },
            payloads: {
              catalog: {
                projects: [],
                sessionCards: { items: [], hasMore: false, missing: [], sessionUiState: {} },
                views: [],
                sessionStatus: {},
                permissions: [],
                questions: [],
                sessionUiState: {},
              },
              operations: { jobs: [], swarms: [] },
            },
          })
        case "/experimental/opencodex/state/capabilities":
          return json({
            scope: { projectID: "proj_test", directory },
            epoch: "test-epoch",
            revision: "capabilities-empty",
            digest: "capabilities-empty",
            payload: {
              provider: { all: [], default: {}, connected: [] },
              config: {},
              agents: [],
              commands: [],
              lsp: [],
              formatter: [],
              mcp: {},
              mcpResources: {},
              plugins: [],
            },
          })
        case "/experimental/opencodex/state/event":
          return stateEvents(input instanceof Request ? input.signal : init?.signal)
        case "/session":
          return json([])
        case "/vcs":
          return json({ branch: "main" })
      }

      throw new Error(`unexpected request: ${url.pathname}`)
    },
    { preconnect: globalThis.fetch.preconnect },
  )

  return { fetch, requests, requestHeaders, session }
}

function stateEvents(signal?: AbortSignal | null) {
  const encoder = new TextEncoder()
  let closed = false
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              type: "ready",
              scope: { projectID: "proj_test", directory },
              epoch: "test-epoch",
              cursor: "test-cursor",
            })}\n\n`,
          ),
        )
        const close = () => {
          if (closed) return
          closed = true
          controller.close()
        }
        if (signal?.aborted) {
          close()
          return
        }
        signal?.addEventListener("abort", close, { once: true })
      },
      cancel() {
        closed = true
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  )
}
