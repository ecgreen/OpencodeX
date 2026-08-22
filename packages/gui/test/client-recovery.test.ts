import { afterEach, describe, expect, test } from "bun:test"
import { connectGuiClient } from "../src/renderer/src/lib/client"

const originalFetch = globalThis.fetch
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window")

afterEach(() => {
  globalThis.fetch = originalFetch
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow)
  else Reflect.deleteProperty(globalThis, "window")
})

describe("GUI client recovery", () => {
  test("re-resolves the sidecar and retries a failed request on its new origin", async () => {
    const first = { url: "http://127.0.0.1:4100", directory: "/repo" }
    const second = { url: "http://127.0.0.1:4200", directory: "/repo" }
    const requests: string[] = []
    let connection = 0
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        opencodex: {
          connection: async () => ({ ok: true as const, value: connection++ === 0 ? first : second }),
        },
      },
    })
    globalThis.fetch = async (input) => {
      const request = input instanceof Request ? input : new Request(input)
      requests.push(request.url)
      if (new URL(request.url).port === "4100") throw new TypeError("connection refused")
      return Response.json(true)
    }

    const gui = await connectGuiClient()
    const result = await gui.client.global.health()

    expect(result.data).toBe(true)
    expect(requests.map((value) => new URL(value).port)).toEqual(["4100", "4200"])
    expect(gui.url).toBe("http://127.0.0.1:4200")
    expect(connection).toBe(2)
  })

  test("refreshes authentication without replaying a POST after an ambiguous failure", async () => {
    const first = {
      url: "http://127.0.0.1:4100",
      directory: "/repo",
      username: "opencode",
      password: "first-secret",
    }
    const second = {
      url: "http://127.0.0.1:4200",
      directory: "/repo",
      username: "opencode",
      password: "second-secret",
    }
    const requests: Array<{ url: string; method: string; authorization: string | null; body: string }> = []
    let connection = 0
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        opencodex: {
          connection: async () => ({ ok: true as const, value: connection++ === 0 ? first : second }),
        },
      },
    })
    globalThis.fetch = async (input) => {
      const request = input instanceof Request ? input : new Request(input)
      requests.push({
        url: request.url,
        method: request.method,
        authorization: request.headers.get("authorization"),
        body: await request.text(),
      })
      if (new URL(request.url).port === "4100") throw new TypeError("connection refused")
      return new Response(null, { status: 204 })
    }

    const gui = await connectGuiClient()
    await expect(
      gui.client.session.promptAsync(
        {
          sessionID: "session-1",
          directory: gui.directory,
          messageID: "message-1",
          parts: [{ type: "text", text: "hello" }],
        },
        { throwOnError: true },
      ),
    ).rejects.toThrow("connection refused")

    expect(requests.map((request) => ({
      port: new URL(request.url).port,
      method: request.method,
      authorization: request.authorization,
      body: JSON.parse(request.body),
    }))).toEqual([
      {
        port: "4100",
        method: "POST",
        authorization: `Basic ${btoa("opencode:first-secret")}`,
        body: { messageID: "message-1", parts: [{ type: "text", text: "hello" }] },
      },
    ])
    expect(gui.authHeader).toBe(`Basic ${btoa("opencode:second-secret")}`)
  })
})
