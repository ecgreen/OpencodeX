import { describe, expect, test } from "bun:test"
import { createCoordinatorTransport } from "../../../../src/cli/cmd/tui/coordinator-transport"
import type { CoordinatorManifest } from "@opencode-ai/sdk/coordinator"

const manifestA: CoordinatorManifest = {
  version: 2,
  key: "coordinator-key",
  directory: "C:\\Work\\OpencodeX",
  database: "opencode-test.db",
  pid: 101,
  url: "http://127.0.0.1:10001/",
  username: "opencodex-local",
  password: "password-a",
  token: "token-a",
  createdAt: "2026-08-09T00:00:00.000Z",
}

const manifestB: CoordinatorManifest = {
  ...manifestA,
  pid: 102,
  url: "http://127.0.0.1:10002/",
  password: "password-b",
  token: "token-b",
}

function basic(manifest: CoordinatorManifest) {
  return "Basic " + Buffer.from(`${manifest.username}:${manifest.password}`).toString("base64")
}

function connectionError() {
  return Object.assign(new Error("Unable to connect. Is the computer able to access the url?"), {
    code: "ConnectionRefused",
  })
}

function abortError() {
  const error = new Error("The operation was aborted.")
  error.name = "AbortError"
  return error
}

type Call = { url: URL; authorization: string | null }

/** Fake fetch that fails with a connection error for every origin except the
 * ones listed in `alive`, and 401s unless the request carries `password`. */
function fakeBackend(input: { alive: string[]; password: string }) {
  const calls: Call[] = []
  const fetch: typeof globalThis.fetch = Object.assign(
    async (request: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => {
      const url = new URL(request instanceof Request ? request.url : String(request))
      const headers = new Headers(init?.headers ?? (request instanceof Request ? request.headers : undefined))
      calls.push({ url, authorization: headers.get("authorization") })
      if (!input.alive.includes(url.origin)) throw connectionError()
      const expected = "Basic " + Buffer.from(`opencodex-local:${input.password}`).toString("base64")
      if (headers.get("authorization") !== expected) return new Response("unauthorized", { status: 401 })
      return new Response("ok", { status: 200 })
    },
    { preconnect: globalThis.fetch.preconnect },
  )
  return { calls, fetch }
}

/** Fake fetch that always throws what `create` builds. */
function throwingFetch(create: () => Error): typeof globalThis.fetch {
  return Object.assign(
    async () => {
      throw create()
    },
    { preconnect: globalThis.fetch.preconnect },
  )
}

/** Captures a rejection so assertions stay synchronous. */
function rejection(promise: Promise<unknown>) {
  return promise.then(
    () => undefined,
    (error: unknown) => error,
  )
}

/**
 * A ReadableStream-backed body. Bun (like undici/browsers) buffers a plain
 * string `body` internally and re-derives a fresh stream on each `Request`
 * construction, which masks the "body already used" defect for ordinary
 * JSON payloads. A genuine `ReadableStream` source is shared by reference
 * when a `Request` is built from another `Request`, so reading it through
 * one derived `Request` really does lock/disturb the original - this is
 * what reproduces the retry-path bug under the old implementation.
 */
function streamBody(text: string) {
  const bytes = new TextEncoder().encode(text)
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
}

describe("coordinator transport", () => {
  test("routes requests to the manifest origin with its credentials", async () => {
    const backend = fakeBackend({ alive: [new URL(manifestA.url).origin], password: manifestA.password })
    const transport = createCoordinatorTransport({
      manifest: manifestA,
      resolve: () => Promise.reject(new Error("must not resolve")),
      fetch: backend.fetch,
    })

    const response = await transport.fetch(new URL("/experimental/opencodex/state?x=1", manifestA.url))
    expect(response.status).toBe(200)
    expect(backend.calls).toHaveLength(1)
    expect(backend.calls[0].url.toString()).toBe("http://127.0.0.1:10001/experimental/opencodex/state?x=1")
    expect(backend.calls[0].authorization).toBe(basic(manifestA))
  })

  test("reattaches after a connection failure and retries against the new coordinator", async () => {
    const backend = fakeBackend({ alive: [new URL(manifestB.url).origin], password: manifestB.password })
    let resolves = 0
    const seen: CoordinatorManifest[] = []
    const transport = createCoordinatorTransport({
      manifest: manifestA,
      resolve: async () => {
        resolves += 1
        return manifestB
      },
      onManifest: (manifest) => seen.push(manifest),
      fetch: backend.fetch,
    })

    const response = await transport.fetch(new URL("/session/status", manifestA.url))
    expect(response.status).toBe(200)
    expect(resolves).toBe(1)
    expect(seen).toEqual([manifestB])
    expect(backend.calls).toHaveLength(2)
    expect(backend.calls[1].url.toString()).toBe("http://127.0.0.1:10002/session/status")
    expect(backend.calls[1].authorization).toBe(basic(manifestB))
    // Later requests go straight to the new coordinator.
    await transport.fetch(new URL("/vcs", manifestA.url))
    expect(backend.calls[2].url.origin).toBe("http://127.0.0.1:10002")
    expect(transport.url).toBe(manifestB.url)
  })

  test("recovers when a replacement coordinator rejects the old credentials", async () => {
    // Same port, new password: the old coordinator died and a new one came up
    // where the TUI still connects, so the failure surfaces as a 401.
    const samePort = { ...manifestB, url: manifestA.url }
    const backend = fakeBackend({ alive: [new URL(manifestA.url).origin], password: samePort.password })
    const transport = createCoordinatorTransport({
      manifest: manifestA,
      resolve: async () => samePort,
      fetch: backend.fetch,
    })

    const response = await transport.fetch(new URL("/config", manifestA.url))
    expect(response.status).toBe(200)
    expect(backend.calls).toHaveLength(2)
    expect(backend.calls[1].authorization).toBe(basic(samePort))
  })

  test("returns the 401 when recovery does not change the outcome", async () => {
    const backend = fakeBackend({ alive: [new URL(manifestA.url).origin], password: "different-password" })
    let resolves = 0
    const transport = createCoordinatorTransport({
      manifest: manifestA,
      resolve: async () => {
        resolves += 1
        return manifestA
      },
      fetch: backend.fetch,
    })

    const response = await transport.fetch(new URL("/config", manifestA.url))
    expect(response.status).toBe(401)
    expect(resolves).toBe(1)
    expect(backend.calls).toHaveLength(2)
  })

  test("concurrent failures share one resolution", async () => {
    const backend = fakeBackend({ alive: [new URL(manifestB.url).origin], password: manifestB.password })
    let resolves = 0
    let release!: (manifest: CoordinatorManifest) => void
    const gate = new Promise<CoordinatorManifest>((resolve) => {
      release = resolve
    })
    const transport = createCoordinatorTransport({
      manifest: manifestA,
      resolve: () => {
        resolves += 1
        return gate
      },
      fetch: backend.fetch,
    })

    const first = transport.fetch(new URL("/a", manifestA.url))
    const second = transport.fetch(new URL("/b", manifestA.url))
    await Bun.sleep(10)
    release(manifestB)
    const responses = await Promise.all([first, second])
    expect(responses.map((response) => response.status)).toEqual([200, 200])
    expect(resolves).toBe(1)
  })

  test("aborts are not treated as coordinator loss", async () => {
    let resolves = 0
    const transport = createCoordinatorTransport({
      manifest: manifestA,
      resolve: async () => {
        resolves += 1
        return manifestB
      },
      fetch: throwingFetch(abortError),
    })

    expect(await rejection(transport.fetch(new URL("/a", manifestA.url)))).toMatchObject({ name: "AbortError" })
    expect(resolves).toBe(0)
  })

  test("propagates the original error when recovery fails", async () => {
    const transport = createCoordinatorTransport({
      manifest: manifestA,
      resolve: async () => {
        throw new Error("no coordinator could be started")
      },
      fetch: throwingFetch(connectionError),
    })

    expect(await rejection(transport.fetch(new URL("/a", manifestA.url)))).toMatchObject({
      code: "ConnectionRefused",
    })
  })

  test("recovers but does not replay a POST after an ambiguous connection failure", async () => {
    const bodies: { origin: string; body: string }[] = []
    let resolves = 0
    const fetchWithBodyCapture: typeof globalThis.fetch = Object.assign(
      async (request: Parameters<typeof globalThis.fetch>[0]) => {
        const req = request as Request
        const url = new URL(req.url)
        const body = await req.text()
        bodies.push({ origin: url.origin, body })
        if (url.origin === new URL(manifestA.url).origin) throw connectionError()
        return new Response("ok", { status: 200 })
      },
      { preconnect: globalThis.fetch.preconnect },
    )

    const transport = createCoordinatorTransport({
      manifest: manifestA,
      resolve: async () => {
        resolves += 1
        return manifestB
      },
      fetch: fetchWithBodyCapture,
    })

    const payload = JSON.stringify({ prompt: "hello world" })
    const request = new Request(new URL("/session/prompt", manifestA.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: streamBody(payload),
    })

    expect(await rejection(transport.fetch(request))).toMatchObject({ code: "ConnectionRefused" })
    expect(resolves).toBe(1)
    expect(bodies).toHaveLength(1)
    expect(bodies[0]).toEqual({ origin: new URL(manifestA.url).origin, body: payload })
    expect(transport.url).toBe(manifestB.url)
  })

  test("failed recovery cools down before it is attempted again", async () => {
    let now = 0
    let resolves = 0
    const transport = createCoordinatorTransport({
      manifest: manifestA,
      resolve: async () => {
        resolves += 1
        throw new Error("still down")
      },
      fetch: throwingFetch(connectionError),
      cooldownMs: 1_500,
      now: () => now,
    })

    expect(await rejection(transport.fetch(new URL("/a", manifestA.url)))).toBeDefined()
    expect(resolves).toBe(1)
    // Within the cooldown the transport fails fast without re-resolving.
    now = 500
    expect(await rejection(transport.fetch(new URL("/b", manifestA.url)))).toBeDefined()
    expect(resolves).toBe(1)
    // After the cooldown it tries again.
    now = 5_000
    expect(await rejection(transport.fetch(new URL("/c", manifestA.url)))).toBeDefined()
    expect(resolves).toBe(2)
  })
})
