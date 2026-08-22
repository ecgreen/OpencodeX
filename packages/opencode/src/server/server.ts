import "./init-projectors"

import { NodeHttpServer } from "@effect/platform-node"
import * as Log from "@opencode-ai/core/util/log"
import { ConfigProvider, Context, Effect, Exit, Layer, Scope } from "effect"
import { HttpRouter, HttpServer } from "effect/unstable/http"
import { OpenApi } from "effect/unstable/httpapi"
import { createServer } from "node:http"
import { MDNS } from "./mdns"
import { HttpApiApp } from "./routes/instance/httpapi/server"
import { disposeMiddleware } from "./routes/instance/httpapi/lifecycle"
import { WebSocketTracker } from "./routes/instance/httpapi/websocket-tracker"
import { PublicApi } from "./routes/instance/httpapi/public"
import type { CorsOptions } from "./cors"
import { lazy } from "@/util/lazy"

// @ts-ignore This global is needed to prevent ai-sdk from logging warnings to stdout https://github.com/vercel/ai/blob/2dc67e0ef538307f21368db32d5a12345d98831b/packages/ai/src/logger/log-warnings.ts#L85
globalThis.AI_SDK_LOG_WARNINGS = false

const log = Log.create({ service: "server" })

export type Listener = {
  hostname: string
  port: number
  url: URL
  stop: (close?: boolean) => Promise<void>
}

type ServerApp = {
  fetch(request: Request): Response | Promise<Response>
  request(input: string | URL | Request, init?: RequestInit): Response | Promise<Response>
}

type ListenOptions = CorsOptions & {
  port: number
  hostname: string
  mdns?: boolean
  mdnsDomain?: string
  /**
   * Internal: when `port` is 0, prefer 4096 before falling back to an
   * OS-assigned port (legacy behavior). Disabled for companion listeners that
   * should take a quiet ephemeral port instead of shadowing 4096.
   */
  prefer4096?: boolean
}
type ListenerState = {
  scope: Scope.Scope
  server: Context.Service.Shape<typeof HttpServer.HttpServer>
  http: ListenerServer
  websockets: WebSocketTracker.Interface
}
type EffectListener = Omit<Listener, "stop"> & {
  stop: (close?: boolean) => Effect.Effect<void>
}

interface ListenerServer {
  readonly closeAll: Effect.Effect<void>
}

class ListenerServerService extends Context.Service<ListenerServerService, ListenerServer>()(
  "@opencode/ListenerServer",
) {}

export const Default = lazy(() => {
  const handler = HttpApiApp.webHandler().handler
  const app: ServerApp = {
    fetch: (request: Request) => handler(request, HttpApiApp.context),
    request(input, init) {
      return app.fetch(input instanceof Request ? input : new Request(new URL(input, "http://localhost"), init))
    },
  }
  return { app }
})

export async function openapi() {
  return OpenApi.fromApi(PublicApi)
}

// The URL of the primary listener started in this process. Kept in sync for
// legacy consumers (`plugin/index.ts`) that read it without getting a handle.
export let url: URL

export async function listen(opts: ListenOptions): Promise<Listener> {
  const listener = await Effect.runPromise(listenEffect(opts))
  return toListenerHandle(listener)
}

/**
 * Starts several HTTP listeners that share one application state — a single
 * event bus, one database layer, one WebSocket tracker — instead of the
 * per-listener memo map `listen` uses. Serving the same app through two
 * sockets from one process (e.g. a LAN endpoint alongside a loopback
 * companion) must expose the same in-process bus or subscribers on each
 * endpoint would silently see different events.
 *
 * All listeners close together: they share one scope, and stopping any of them
 * closes it (application disposal runs once). Call the handles' `stop` in the
 * same order as the return value if ordering matters on shutdown.
 */
export async function listenShared(optsList: ListenOptions[]): Promise<Listener[]> {
  const listeners = await Effect.runPromise(listenSharedEffect(optsList))
  return listeners.map(toListenerHandle)
}

function toListenerHandle(listener: EffectListener): Listener {
  return {
    hostname: listener.hostname,
    port: listener.port,
    url: listener.url,
    stop: (close?: boolean) => Effect.runPromiseExit(listener.stop(close)).then(() => undefined),
  }
}

const listenEffect: (opts: ListenOptions) => Effect.Effect<EffectListener, unknown> = Effect.fn("Server.listen")(
  function* (opts: ListenOptions) {
    const state = yield* startWithPortFallback(opts)
    const address = yield* tcpAddress(state)
    const listenerUrl = makeURL(opts.hostname, address.port)
    url = listenerUrl

    const unpublishMdns = yield* setupMdns(opts, address.port, state.scope)

    return {
      hostname: opts.hostname,
      port: address.port,
      url: listenerUrl,
      stop: yield* makeStop(state, unpublishMdns),
    }
  },
)

function listenSharedEffect(optsList: ListenOptions[]): Effect.Effect<Array<EffectListener>, unknown> {
  if (optsList.length === 0) return Effect.succeed([])
  // A single scope plus a single app layer means every socket serves the same
  // application build: one event bus, one database layer, one WebSocket
  // tracker. Failing to share them would give loopback and LAN subscribers
  // process-local buses that see different events.
  const scope = Scope.makeUnsafe()
  const memoMap = Layer.makeMemoMapUnsafe()
  // CORS comes from the first listener; the loopback companion is used by
  // local clients and does not need its own origin policy.
  const sharedApp = HttpApiApp.createRoutes(optsList[0])
  return Effect.gen(function* () {
    const listeners: EffectListener[] = []
    for (const opts of optsList) {
      const state = yield* startInSharedScope(opts, memoMap, scope, sharedApp)
      const address = yield* tcpAddress(state)
      const listenerUrl = makeURL(opts.hostname, address.port)
      // The legacy `Server.url` points at the primary (first) listener. A
      // companion socket is a second bind for the same authority, not a URL
      // legacy consumers should attach to.
      if (listeners.length === 0) url = listenerUrl
      const unpublishMdns = yield* setupMdns(opts, address.port, scope)
      listeners.push({
        hostname: opts.hostname,
        port: address.port,
        url: listenerUrl,
        stop: yield* makeStop(state, unpublishMdns),
      })
    }
    return listeners
  }).pipe(
    Effect.onError(() => Scope.close(scope, Exit.void).pipe(Effect.ignore)),
    Effect.withSpan("Server.listenShared.build"),
  )
}

function listenerLayer(opts: ListenOptions, port: number, app?: ReturnType<typeof HttpApiApp.createRoutes>) {
  return HttpRouter.serve(app ?? HttpApiApp.createRoutes(opts), {
    middleware: disposeMiddleware,
    disableLogger: true,
    disableListenLog: true,
  }).pipe(
    Layer.provideMerge(WebSocketTracker.layer),
    Layer.provideMerge(serverLayer({ port, hostname: opts.hostname })),
    // Install a fresh `ConfigProvider` per listener so `Config.string(...)`
    // reads reflect the current `process.env`. Effect's default
    // `ConfigProvider` snapshots `process.env` on first read and caches the
    // result on a module-singleton Reference; without overriding it here,
    // every later `Server.listen()` keeps observing that initial snapshot.
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnv())),
  )
}

function startWithPortFallback(opts: ListenOptions) {
  const scope = Scope.makeUnsafe()
  const memoMap = Layer.makeMemoMapUnsafe()
  return startWithPortFallbackIn(opts, memoMap, scope).pipe(
    Effect.onError(() => Scope.close(scope, Exit.void).pipe(Effect.ignore)),
  )
}

function startWithPortFallbackIn(
  opts: ListenOptions,
  memoMap: Layer.MemoMap,
  scope: Scope.Scope,
  app?: ReturnType<typeof HttpApiApp.createRoutes>,
) {
  // Both attempts run on the caller's scope, so neither may close it on its own
  // failure; the caller owns scope cleanup when every attempt fails.
  if (opts.port !== 0) return startListenerIn(opts, opts.port, memoMap, scope, app)
  if (opts.prefer4096 === false) return startListenerIn(opts, 0, memoMap, scope, app)
  // Match the legacy listener port-resolution behavior: explicit `0` prefers
  // 4096 first, then any free port.
  return startListenerIn(opts, 4096, memoMap, scope, app).pipe(
    Effect.catch(() => startListenerIn(opts, 0, memoMap, scope, app)),
  )
}

function startInSharedScope(
  opts: ListenOptions,
  memoMap: Layer.MemoMap,
  scope: Scope.Scope,
  app: ReturnType<typeof HttpApiApp.createRoutes>,
) {
  if (opts.port !== 0) return startListenerIn(opts, opts.port, memoMap, scope, app)
  if (opts.prefer4096 === false) return startListenerIn(opts, 0, memoMap, scope, app)
  // Try the legacy 4096 preference first. A failed attempt must NOT close the
  // shared scope (that would tear down peers built into it), so the retry runs
  // on the same scope and only the builder's own outer error path closes it.
  return startListenerIn(opts, 4096, memoMap, scope, app).pipe(
    Effect.catch(() => startListenerIn(opts, 0, memoMap, scope, app)),
  )
}

function startListenerIn(
  opts: ListenOptions,
  port: number,
  memoMap: Layer.MemoMap,
  scope: Scope.Scope,
  app?: ReturnType<typeof HttpApiApp.createRoutes>,
) {
  // Does not close `scope` on failure: callers reuse the scope across the
  // port-fallback retry or share it between listeners, so they own cleanup.
  return Layer.buildWithMemoMap(listenerLayer(opts, port, app), memoMap, scope).pipe(
    Effect.provide(HttpApiApp.context),
    Effect.map(
      (ctx): ListenerState => ({
        scope,
        server: Context.get(ctx, HttpServer.HttpServer),
        http: Context.get(ctx, ListenerServerService),
        websockets: Context.get(ctx, WebSocketTracker.Service),
      }),
    ),
  )
}

function tcpAddress(state: ListenerState) {
  return Effect.gen(function* () {
    if (state.server.address._tag === "TcpAddress") return state.server.address
    yield* Scope.close(state.scope, Exit.void).pipe(Effect.ignore)
    return yield* Effect.die(new Error(`Unexpected HttpServer address tag: ${state.server.address._tag}`))
  })
}

function makeURL(hostname: string, port: number) {
  const result = new URL("http://localhost")
  result.hostname = hostname
  result.port = String(port)
  return result
}

function setupMdns(opts: ListenOptions, port: number, scope: Scope.Scope) {
  return Effect.gen(function* () {
    const publish =
      opts.mdns && port && opts.hostname !== "127.0.0.1" && opts.hostname !== "localhost" && opts.hostname !== "::1"
    if (publish) {
      const unpublish = yield* Effect.cached(Effect.sync(() => MDNS.unpublish()))
      yield* Effect.sync(() => MDNS.publish(port, opts.mdnsDomain))
      yield* Scope.addFinalizer(scope, unpublish)
      return unpublish
    }
    if (opts.mdns) log.warn("mDNS enabled but hostname is loopback; skipping mDNS publish")
    return Effect.void
  })
}

function makeStop(state: ListenerState, unpublishMdns: Effect.Effect<void>) {
  return Effect.gen(function* () {
    const forceCloseOnce = yield* Effect.cached(forceClose(state).pipe(Effect.ignore))
    const closeScopeOnce = yield* Effect.cached(Scope.close(state.scope, Exit.void).pipe(Effect.ignore))

    return (close?: boolean) =>
      Effect.gen(function* () {
        yield* unpublishMdns
        if (close) yield* forceCloseOnce
        yield* closeScopeOnce
      })
  })
}

function forceClose(state: ListenerState) {
  return Effect.all([state.http.closeAll, state.websockets.closeAll], { concurrency: "unbounded", discard: true })
}

function serverLayer(opts: { port: number; hostname: string }) {
  const server = createServer()
  const serverRef = { closeStarted: false, forceStop: false }
  const close = server.close.bind(server)
  // Keep shutdown owned by NodeHttpServer, but honor listener.stop(true) by
  // force-closing active HTTP sockets when its finalizer calls server.close().
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- Node's overloads don't preserve a monkey-patched method assignment.
  server.close = ((callback?: Parameters<typeof server.close>[0]) => {
    serverRef.closeStarted = true
    const result = close(callback)
    if (serverRef.forceStop) server.closeAllConnections()
    return result
  }) as typeof server.close

  return Layer.mergeAll(
    NodeHttpServer.layer(() => server, { port: opts.port, host: opts.hostname, gracefulShutdownTimeout: "1 second" }),
    Layer.succeed(ListenerServerService)(
      ListenerServerService.of({
        closeAll: Effect.sync(() => {
          serverRef.forceStop = true
          if (serverRef.closeStarted) server.closeAllConnections()
        }),
      }),
    ),
  )
}

export * as Server from "./server"
