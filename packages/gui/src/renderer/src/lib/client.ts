import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk/v2/client"

export type GuiClient = {
  client: OpencodeClient
  url: string
  directory: string
  authHeader: string
}

type BackendConnection = {
  url: string
  directory?: string
  username?: string
  password?: string
}

function encodeBasic(username: string, password: string) {
  return `Basic ${btoa(`${username}:${password}`)}`
}

export async function connectGuiClient(): Promise<GuiClient> {
  let connection: BackendConnection = window.opencodex
    ? await window.opencodex.connection()
    : {
        url: import.meta.env.VITE_OPENCODEX_SERVER_URL ?? "http://127.0.0.1:4096",
        directory: import.meta.env.VITE_OPENCODEX_DIRECTORY ?? import.meta.env.PWD ?? "",
        username: import.meta.env.VITE_OPENCODEX_SERVER_USERNAME ?? "opencode",
        password: import.meta.env.VITE_OPENCODEX_SERVER_PASSWORD ?? "",
      }

  let generation = 0
  let recovery: Promise<void> | undefined
  const rawFetch = globalThis.fetch.bind(globalThis)
  const recover = async (failedGeneration: number) => {
    if (!window.opencodex || failedGeneration !== generation) return
    recovery ??= window.opencodex
      .connection()
      .then((next) => {
        connection = next
        generation += 1
      })
      .finally(() => {
        recovery = undefined
      })
    await recovery
  }
  const routedFetch = Object.assign(
    async (...args: Parameters<typeof fetch>) => {
      const request = new Request(...args)
      const body = request.body ? await request.arrayBuffer() : undefined
      const failedGeneration = generation
      try {
        const response = await rawFetch(routeRequest(request, connection, body))
        if (response.status !== 401 || !window.opencodex) return response
        await response.body?.cancel().catch(() => undefined)
      } catch (cause) {
        if (request.signal.aborted || !window.opencodex) throw cause
      }
      await recover(failedGeneration)
      return rawFetch(routeRequest(request, connection, body))
    },
    { preconnect: fetchPreconnect },
  )
  const client = createOpencodeClient({
    baseUrl: connection.url,
    directory: connection.directory ?? "",
    headers: connectionAuthHeader(connection) ? { authorization: connectionAuthHeader(connection) } : undefined,
    fetch: routedFetch,
  })

  return {
    client,
    get url() {
      return connection.url
    },
    get directory() {
      return connection.directory ?? ""
    },
    get authHeader() {
      return connectionAuthHeader(connection)
    },
  }
}

function fetchPreconnect(url: string | URL) {
  const preconnect: unknown = Reflect.get(globalThis.fetch, "preconnect")
  if (typeof preconnect === "function") Reflect.apply(preconnect, globalThis.fetch, [url])
}

function connectionAuthHeader(connection: BackendConnection) {
  return connection.username && connection.password ? encodeBasic(connection.username, connection.password) : ""
}

function routeRequest(request: Request, connection: BackendConnection, body?: ArrayBuffer) {
  const source = new URL(request.url)
  const headers = new Headers(request.headers)
  const authHeader = connectionAuthHeader(connection)
  if (authHeader) headers.set("authorization", authHeader)
  else headers.delete("authorization")
  return new Request(new URL(`${source.pathname}${source.search}`, connection.url), {
    body,
    cache: request.cache,
    credentials: request.credentials,
    headers,
    integrity: request.integrity,
    keepalive: request.keepalive,
    method: request.method,
    mode: request.mode,
    redirect: request.redirect,
    referrer: request.referrer,
    referrerPolicy: request.referrerPolicy,
    signal: request.signal,
  })
}
