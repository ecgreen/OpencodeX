import { expect, test } from "bun:test"
import { createOpencodeClient, type GlobalEvent } from "@opencode-ai/sdk/v2/client"
import { subscribeEvents } from "../src/renderer/src/lib/session-api"

test("raw event subscription retries failed initialization and stops after cancellation", async () => {
  let eventConnections = 0
  let syncStarts = 0
  const paths: string[] = []
  const fetch = Object.assign(
    async (input: Parameters<typeof globalThis.fetch>[0]) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      paths.push(url.pathname)
      if (url.pathname === "/global/event") {
        eventConnections += 1
        return new Response(
          `data: ${JSON.stringify({
            directory: "/repo",
            project: "project-1",
            payload: { id: `event-${eventConnections}`, type: "file.edited", properties: { file: "src/app.ts" } },
          } satisfies GlobalEvent)}\n\n`,
          { headers: { "content-type": "text/event-stream" } },
        )
      }
      if (url.pathname === "/sync/start") {
        syncStarts += 1
        if (syncStarts === 1)
          return new Response(JSON.stringify({ message: "not ready" }), {
            status: 503,
            headers: { "content-type": "application/json" },
          })
        return new Response("true", { headers: { "content-type": "application/json" } })
      }
      throw new Error(`unexpected request: ${url.pathname}`)
    },
    { preconnect: globalThis.fetch.preconnect },
  )
  const gui = {
    client: createOpencodeClient({ baseUrl: "http://test", directory: "/repo", fetch }),
    url: "http://test",
    directory: "/repo",
    authHeader: "",
  }
  const received: GlobalEvent[] = []
  let unsubscribe = () => {}
  unsubscribe = subscribeEvents(
    gui,
    (event) => {
      received.push(event)
      unsubscribe()
    },
    { retryDelayMs: 1, maxRetryDelayMs: 1 },
  )
  await wait(() => received.length === 1)

  expect({ eventConnections, syncStarts, paths }).toEqual({
    eventConnections: 1,
    syncStarts: 2,
    paths: ["/sync/start", "/sync/start", "/global/event"],
  })
  expect(syncStarts).toBe(2)
  await Bun.sleep(10)
  expect(eventConnections).toBe(1)
})

async function wait(fn: () => boolean, timeout = 2_000) {
  const started = Date.now()
  while (!fn()) {
    if (Date.now() - started > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}
