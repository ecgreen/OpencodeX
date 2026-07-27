import { afterEach, describe, expect, test } from "bun:test"
import { SessionLegacy } from "@opencode-ai/core/session/legacy"
import { Deferred, Effect, Layer } from "effect"
import type * as Scope from "effect/Scope"
import { HttpServer } from "effect/unstable/http"
import { ChildProcessSpawner } from "effect/unstable/process"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Flag } from "@opencode-ai/core/flag/flag"
import { createOpencodeClient } from "@opencode-ai/sdk/v2"
import { validateSession } from "../../src/cli/cmd/tui/validate-session"
import { InstanceBootstrap } from "../../src/project/bootstrap-service"
import { InstanceStore } from "../../src/project/instance-store"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionStatus } from "../../src/session/status"
import { sessionStatusSnapshot } from "../../src/server/routes/instance/httpapi/handlers/opencodex"

import type { Config } from "@/config/config"
import { Session as SessionNs } from "@/session/session"
import { errorMessage } from "../../src/util/error"
import { TestLLMServer, httpError } from "../lib/llm-server"
import path from "path"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, TestInstance, tmpdirScoped } from "../fixture/fixture"
import { awaitWithTimeout, testEffect } from "../lib/effect"
import { testProviderConfig } from "../lib/test-provider"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Database } from "@opencode-ai/core/database/database"
import { httpApiLayer } from "./httpapi-layer"

const noopBootstrap = Layer.succeed(InstanceBootstrap.Service, InstanceBootstrap.Service.of({ run: Effect.void }))
const it = testEffect(
  Layer.mergeAll(
    AppFileSystem.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    InstanceStore.defaultLayer.pipe(Layer.provide(noopBootstrap)),
    Database.defaultLayer,
    httpApiLayer,
  ),
)

const original = {
  OPENCODE_SERVER_PASSWORD: Flag.OPENCODE_SERVER_PASSWORD,
  OPENCODE_SERVER_USERNAME: Flag.OPENCODE_SERVER_USERNAME,
}

type ServerPath = "default" | "raw"
type Sdk = ReturnType<typeof createOpencodeClient>
type SdkResult = { response: Response; data?: unknown; error?: unknown }
type Captured = { status: number; data?: unknown; error?: unknown }
type ProjectFixture = { sdk: Sdk; directory: string }
type LlmProjectFixture = ProjectFixture & { llm: TestLLMServer["Service"] }
type TestServices =
  | AppFileSystem.Service
  | ChildProcessSpawner.ChildProcessSpawner
  | InstanceStore.Service
  | HttpServer.HttpServer
type TestScope = Scope.Scope | TestServices

function client(
  serverPath: ServerPath,
  directory?: string,
  input?: { password?: string; username?: string; headers?: Record<string, string> },
) {
  return serverFetch(serverPath, input).pipe(
    Effect.map((fetch) =>
      createOpencodeClient({
        baseUrl: "http://localhost",
        directory,
        headers: input?.headers,
        fetch,
      }),
    ),
  )
}

function serverFetch(serverPath: ServerPath, input?: { password?: string; username?: string }) {
  return HttpServer.HttpServer.use((server) =>
    Effect.sync(() => {
      void serverPath
      Flag.OPENCODE_SERVER_PASSWORD = input?.password
      Flag.OPENCODE_SERVER_USERNAME = input?.username
      const baseUrl = HttpServer.formatAddress(server.address)
      return Object.assign(
        async (request: RequestInfo | URL, init?: RequestInit) => {
          const source = request instanceof Request ? request : new Request(request, init)
          const url = new URL(source.url)
          return globalThis.fetch(new Request(new URL(`${url.pathname}${url.search}`, baseUrl), source))
        },
        { preconnect: globalThis.fetch.preconnect },
      ) satisfies typeof globalThis.fetch
    }),
  )
}

function authorization(username: string, password: string) {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`
}

function call<T>(request: () => Promise<T>) {
  return Effect.promise(request)
}

function capture(request: () => Promise<SdkResult>) {
  return call(request).pipe(
    Effect.map((result) => ({
      status: result.response.status,
      data: result.data,
      error: result.error,
    })),
  )
}

function captureThrown(request: () => Promise<unknown>) {
  return call(async () => {
    try {
      await request()
      return undefined
    } catch (error) {
      return error
    }
  })
}

function expectStatus(request: () => Promise<{ response: Response }>, status: number) {
  return call(request).pipe(
    Effect.tap((result) => Effect.sync(() => expect(result.response.status).toBe(status))),
    Effect.asVoid,
  )
}

function firstEvent(open: (signal: AbortSignal) => Promise<{ stream: AsyncIterator<unknown> }>) {
  return Effect.acquireRelease(
    Effect.sync(() => new AbortController()),
    (controller) => Effect.sync(() => controller.abort()),
  ).pipe(
    Effect.flatMap((controller) =>
      Effect.acquireRelease(
        call(() => open(controller.signal)),
        (events) => call(async () => void (await events.stream.return?.(undefined))).pipe(Effect.ignore),
      ).pipe(
        Effect.flatMap((events) =>
          call(() => events.stream.next()).pipe(
            Effect.timeoutOrElse({
              duration: "1 second",
              orElse: () => Effect.fail(new Error("timed out waiting for SDK event")),
            }),
          ),
        ),
        Effect.map((result) => result.value),
      ),
    ),
  )
}

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : {}
}

function array(value: unknown) {
  return Array.isArray(value) ? value : []
}

function statuses(input: Record<string, Captured>) {
  return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, value.status]))
}

function waitForSwarm(sdk: Sdk, swarmID: string) {
  return Effect.gen(function* () {
    let current: Captured | undefined
    for (const _ of Array.from({ length: 400 })) {
      current = yield* capture(() => sdk.opencodex.swarm.get({ swarmID }))
      if (["completed", "partially_failed", "failed", "cancelled"].includes(String(record(current.data).status))) {
        return current
      }
      yield* Effect.sleep(25)
    }
    return yield* Effect.die(`Timed out waiting for swarm ${swarmID}; last status ${record(current?.data).status}`)
  })
}

function createDurableSwarm(input: { sdk: Sdk; directory: string; title: string; workers?: string[] }) {
  return Effect.gen(function* () {
    const project = yield* capture(() =>
      input.sdk.opencodex.project.create({
        opencodeXProjectCreateInput: { name: input.title, directory: input.directory, folders: [input.directory] },
      }),
    )
    const swarm = yield* capture(() =>
      input.sdk.opencodex.swarm.create({
        opencodeXSwarmCreateInput: {
          projectID: String(record(project.data).id),
          title: input.title,
          source: "manual",
          roles: [
            {
              name: "Orchestrator",
              skill: "orchestrator",
              providerID: "test",
              modelID: "test-model",
              instructions: "Coordinate the worker.",
            },
            ...(input.workers ?? ["Worker"]).map((name) => ({
              name,
              skill: "engineer",
              providerID: "test",
              modelID: "test-model",
              instructions: "Complete the assigned work.",
            })),
          ],
        },
      }),
    )
    return String(record(swarm.data).id)
  })
}

function firstPartText(value: unknown) {
  return record(array(record(value).parts)[0]).text
}

function sessionTitles(value: unknown) {
  return array(value)
    .map((item) => record(item).title)
    .filter((title): title is string => typeof title === "string")
    .sort()
}

function httpapi<A, E>(name: string, effect: Effect.Effect<A, E, TestScope>) {
  it.live(name, effect)
}

function httpapiInstance<A, E>(
  name: string,
  options: {
    serverPath: ServerPath
    git?: boolean
    config?: Partial<Config.Info>
    setup?: (dir: string) => Effect.Effect<void, E, TestServices>
  },
  run: (input: ProjectFixture) => Effect.Effect<A, E, TestScope>,
) {
  it.instance(
    name,
    Effect.gen(function* () {
      const instance = yield* TestInstance
      yield* options.setup?.(instance.directory) ?? Effect.void
      return yield* run({ sdk: yield* client(options.serverPath, instance.directory), directory: instance.directory })
    }),
    { git: options.git ?? true, config: { formatter: false, lsp: false, ...options.config } },
  )
}

function serverPathParity<A, E>(name: string, scenario: (serverPath: ServerPath) => Effect.Effect<A, E, TestScope>) {
  it.live(name, scenario("raw"))
}

function withProject<A, E, E2 = never>(
  serverPath: ServerPath,
  options: {
    git?: boolean
    config?: Partial<Config.Info>
    setup?: (dir: string) => Effect.Effect<void, E2, TestServices>
  },
  run: (input: ProjectFixture) => Effect.Effect<A, E, TestScope>,
) {
  return Effect.gen(function* () {
    const directory = yield* tmpdirScoped({
      git: options.git ?? false,
      config: { formatter: false, lsp: false, ...options.config },
    })
    yield* options.setup?.(directory) ?? Effect.void
    return yield* run({ sdk: yield* client(serverPath, directory), directory })
  })
}

function withStandardProject<A, E>(
  serverPath: ServerPath,
  run: (input: ProjectFixture) => Effect.Effect<A, E, TestScope>,
) {
  return withProject(serverPath, { setup: writeStandardFiles }, run)
}

function withFakeLlm<A, E>(serverPath: ServerPath, run: (input: LlmProjectFixture) => Effect.Effect<A, E, TestScope>) {
  return Effect.gen(function* () {
    const llm = yield* TestLLMServer
    return yield* withProject(serverPath, { config: testProviderConfig(llm.url) }, (input) => run({ ...input, llm }))
  }).pipe(Effect.provide(TestLLMServer.layer))
}

function withFakeLlmProject<A, E>(
  serverPath: ServerPath,
  options: { setup?: (dir: string) => Effect.Effect<void, E, TestServices> },
  run: (input: LlmProjectFixture) => Effect.Effect<A, E, TestScope>,
) {
  return Effect.gen(function* () {
    const llm = yield* TestLLMServer
    return yield* withProject(
      serverPath,
      {
        config: testProviderConfig(llm.url),
        setup: options.setup,
      },
      (input) => run({ ...input, llm }),
    )
  }).pipe(Effect.provide(TestLLMServer.layer))
}

function writeStandardFiles(dir: string) {
  return AppFileSystem.Service.use((fs) =>
    Effect.all([
      fs.writeWithDirs(path.join(dir, "hello.txt"), "hello"),
      fs.writeWithDirs(path.join(dir, "needle.ts"), "export const needle = 'sdk-parity'\n"),
    ]).pipe(Effect.asVoid),
  )
}

function writeProjectSkill(dir: string) {
  return AppFileSystem.Service.use((fs) =>
    fs.writeWithDirs(
      path.join(dir, ".opencode", "skills", "project-rest-skill", "SKILL.md"),
      `---
name: project-rest-skill
description: A project skill visible to REST API prompts.
---

# Project REST Skill
`,
    ),
  )
}

function seedMessage(directory: string, sessionID: string) {
  const id = SessionID.make(sessionID)
  return InstanceStore.Service.use((store) =>
    store.provide(
      { directory },
      SessionNs.Service.use((svc) =>
        Effect.gen(function* () {
          const message = yield* svc.updateMessage({
            id: MessageID.ascending(),
            sessionID: id,
            role: "user",
            time: { created: Date.now() },
            agent: "test",
            model: { providerID: ProviderV2.ID.make("test"), modelID: ProviderV2.ModelID.make("test") },
            tools: {},
          } satisfies SessionLegacy.User)
          const part = yield* svc.updatePart({
            id: PartID.ascending(),
            sessionID: id,
            messageID: message.id,
            type: "text",
            text: "seeded message",
          })
          return { message, part }
        }),
      ).pipe(Effect.provide(SessionNs.defaultLayer)),
    ),
  )
}

afterEach(async () => {
  Flag.OPENCODE_SERVER_PASSWORD = original.OPENCODE_SERVER_PASSWORD
  Flag.OPENCODE_SERVER_USERNAME = original.OPENCODE_SERVER_USERNAME
  await disposeAllInstances()
  await resetDatabase()
})

describe("HttpApi SDK", () => {
  test("session sync projects runtime status without restoring historical activity", () => {
    const sessionID = SessionID.make("ses_stale_busy")

    expect(sessionStatusSnapshot(new Map())).toEqual({})
    expect(sessionStatusSnapshot(new Map([[sessionID, { type: "busy" }]]))).toEqual({
      [sessionID]: { type: "busy" },
    })
    expect(sessionStatusSnapshot(new Map([[sessionID, { type: "retry", attempt: 1, message: "retrying", next: 1 }]]))).toEqual({
      [sessionID]: { type: "retry", attempt: 1, message: "retrying", next: 1 },
    })
  })

  httpapi(
    "uses the generated SDK for global and control routes",
    Effect.gen(function* () {
      const sdk = yield* client("raw")
      const health = yield* call(() => sdk.global.health())
      const log = yield* call(() => sdk.app.log({ service: "httpapi-sdk-test", level: "info", message: "hello" }))

      expect(health.response.status).toBe(200)
      expect(health.data).toMatchObject({ healthy: true })
      expect(yield* firstEvent((signal) => sdk.global.event({ signal }))).toMatchObject({
        payload: { type: "server.connected" },
      })
      expect(log.response.status).toBe(200)
      expect(log.data).toBe(true)
      yield* expectStatus(() => sdk.auth.set({ providerID: "test" }), 400)
    }),
  )

  httpapiInstance(
    "uses the generated SDK for safe instance routes",
    { serverPath: "raw", git: false, setup: writeStandardFiles },
    ({ sdk }) =>
      Effect.gen(function* () {
        const file = yield* call(() => sdk.file.read({ path: "hello.txt" }))
        const session = yield* call(() => sdk.session.create({ title: "sdk" }))
        const listed = yield* call(() => sdk.session.list({ roots: true, limit: 10 }))

        expect(file.response.status).toBe(200)
        expect(file.data).toMatchObject({ content: "hello" })
        expect(session.response.status).toBe(200)
        expect(session.data).toMatchObject({ title: "sdk" })
        expect(listed.response.status).toBe(200)
        expect(listed.data?.map((item) => item.id)).toContain(session.data?.id)

        yield* Effect.all([
          expectStatus(() => sdk.project.current(), 200),
          expectStatus(() => sdk.config.get(), 200),
          expectStatus(() => sdk.config.providers(), 200),
          expectStatus(() => sdk.find.files({ query: "hello", limit: 10 }), 200),
        ])
      }),
  )

  serverPathParity("matches generated SDK OpencodeX session sync routes", (serverPath) =>
    withStandardProject(serverPath, ({ sdk, directory }) =>
      Effect.gen(function* () {
        const first = yield* capture(() => sdk.session.create({ title: "sync-one" }))
        const firstID = String(record(first.data).id)
        const firstSync = yield* capture(() => sdk.opencodex.session.sync({ limit: "10" }))
        const firstBody = record(firstSync.data)
        const firstSnapshot = record(firstBody.snapshot)
        const firstSessions = array(firstSnapshot.sessions)
        const firstSession = record(firstSessions.find((session) => record(session).id === firstID))
        const unchanged = yield* capture(() =>
          sdk.opencodex.session.sync({ limit: "10", since: String(firstBody.revision) }),
        )
        const replayedBusy = yield* capture(() =>
          sdk.sync.replay({
            body_directory: directory,
            events: [{
              id: "evt_test_status_busy",
              aggregateID: firstID,
              seq: 1,
              type: "session.status.1",
              data: { sessionID: firstID, status: { type: "busy" } },
            }],
          }),
        )
        const busy = yield* capture(() =>
          sdk.opencodex.session.sync({ limit: "10", since: String(firstBody.revision) }),
        )
        const replayedIdle = yield* capture(() =>
          sdk.sync.replay({
            body_directory: directory,
            events: [{
              id: "evt_test_status_idle",
              aggregateID: firstID,
              seq: 2,
              type: "session.status.1",
              data: { sessionID: firstID, status: { type: "idle" } },
            }],
          }),
        )
        const idle = yield* capture(() =>
          sdk.opencodex.session.sync({ limit: "10", since: String(firstBody.revision) }),
        )
        const updated = yield* capture(() =>
          sdk.opencodex.sessionState.update({
            sessionID: firstID,
            seenAt: Date.now(),
            reviewedAt: Date.now(),
            reviewedFiles: ["hello.txt"],
          }),
        )
        const reviewed = yield* capture(() =>
          sdk.opencodex.session.sync({ limit: "10", since: String(firstBody.revision) }),
        )
        const reviewedSnapshot = record(record(reviewed.data).snapshot)
        const reviewedUi = record(record(reviewedSnapshot.sessionUiState)[firstID])
        const second = yield* capture(() => sdk.session.create({ title: "sync-two" }))
        const secondID = String(record(second.data).id)
        const afterSecond = yield* capture(() =>
          sdk.opencodex.session.sync({ limit: "10", since: String(record(reviewed.data).revision) }),
        )
        const afterSecondSnapshot = record(record(afterSecond.data).snapshot)

        expect(JSON.stringify(firstSnapshot)).not.toContain('"messages"')
        expect(JSON.stringify(firstSnapshot)).not.toContain('"parts"')
        expect(JSON.stringify(firstSnapshot)).not.toContain('"todos"')
        expect(JSON.stringify(firstSnapshot)).not.toContain('"diffs"')

        expect(statuses({ first, firstSync, unchanged, replayedBusy, busy, replayedIdle, idle, updated, reviewed, second, afterSecond })).toEqual({
          first: 200,
          firstSync: 200,
          unchanged: 200,
          replayedBusy: 200,
          busy: 200,
          replayedIdle: 200,
          idle: 200,
          updated: 200,
          reviewed: 200,
          second: 200,
          afterSecond: 200,
        })
        expect(firstBody.changed).toBe(true)
        expect(firstSession.title).toBe("sync-one")
        expect(record(unchanged.data)).toEqual({ changed: false, revision: firstBody.revision })
        expect(record(busy.data)).toEqual({ changed: false, revision: firstBody.revision })
        expect(record(idle.data)).toEqual({ changed: false, revision: firstBody.revision })
        expect(array(record(updated.data).reviewedFiles)).toEqual(["hello.txt"])
        expect(record(reviewed.data).changed).toBe(true)
        expect(reviewedUi.displayStatus).toBe("idle")
        expect(reviewedUi.updated).toBe(false)
        expect(record(afterSecond.data).changed).toBe(true)
        expect(array(afterSecondSnapshot.sessions).map((session) => record(session).id)).toContain(secondID)
      }),
    ),
  )

  serverPathParity("matches generated SDK global and control behavior", (serverPath) =>
    Effect.gen(function* () {
      const sdk = yield* client(serverPath)
      const health = yield* capture(() => sdk.global.health())
      const log = yield* capture(() => sdk.app.log({ service: "sdk-parity", level: "info", message: "hello" }))
      const invalidAuth = yield* capture(() => sdk.auth.set({ providerID: "test" }))

      return {
        statuses: statuses({ health, log, invalidAuth }),
        health: record(health.data).healthy,
        log: log.data,
      }
    }),
  )

  serverPathParity("matches generated SDK global event stream", (serverPath) =>
    Effect.gen(function* () {
      const sdk = yield* client(serverPath)
      const event = yield* firstEvent((signal) => sdk.global.event({ signal }))
      return { type: record(record(event).payload).type }
    }),
  )

  serverPathParity("matches generated SDK instance event stream", (serverPath) =>
    withStandardProject(serverPath, ({ sdk }) =>
      firstEvent((signal) => sdk.event.subscribe(undefined, { signal })).pipe(
        Effect.map((event) => ({ type: record(record(event).payload).type })),
      ),
    ),
  )

  serverPathParity("matches generated SDK missing session errors", (serverPath) =>
    withStandardProject(serverPath, ({ sdk }) =>
      Effect.gen(function* () {
        const sessionID = "ses_missing"
        const expected = {
          name: "NotFoundError",
          data: { message: `Session not found: ${sessionID}` },
        }
        const missing = yield* capture(() => sdk.session.get({ sessionID }))
        const thrown = yield* captureThrown(() => sdk.session.get({ sessionID }, { throwOnError: true }))

        // Result-tuple path: error body is preserved as-is so existing
        // consumers reading `result.error.name` / `JSON.stringify(error)`
        // keep working byte-for-byte.
        expect(missing.error).toEqual(expected)
        // throwOnError path: SDK wraps the body in a real Error with the
        // server's message, with the original parsed body preserved under
        // `.cause.body`.
        expect(thrown).toBeInstanceOf(Error)
        expect((thrown as Error).message).toBe(expected.data.message)
        expect(((thrown as Error).cause as { body: unknown }).body).toEqual(expected)
        return {
          status: missing.status,
          error: missing.error,
          thrown,
        }
      }),
    ),
  )

  serverPathParity("formats missing session validation errors for -s", (serverPath) =>
    withStandardProject(serverPath, ({ directory }) =>
      Effect.gen(function* () {
        const sessionID = "ses_206f84f18ffeZ6hhD7pFYAiW5T"
        const fetch = yield* serverFetch(serverPath)
        const thrown = yield* captureThrown(() =>
          validateSession({
            url: "http://localhost",
            directory,
            sessionID,
            fetch,
          }),
        )
        expect(errorMessage(thrown)).toBe(`Session not found: ${sessionID}`)
        return errorMessage(thrown)
      }),
    ),
  )

  httpapiInstance(
    "uses generated SDK basic auth behavior",
    { serverPath: "raw", setup: writeStandardFiles },
    ({ directory }) =>
      Effect.gen(function* () {
        const missingSdk = yield* client("raw", directory, { password: "secret" })
        const missing = yield* capture(() => missingSdk.file.read({ path: "hello.txt" }))
        const badSdk = yield* client("raw", directory, {
          password: "secret",
          headers: { authorization: authorization("opencode", "wrong") },
        })
        const bad = yield* capture(() => badSdk.file.read({ path: "hello.txt" }))
        const goodSdk = yield* client("raw", directory, {
          password: "secret",
          headers: { authorization: authorization("opencode", "secret") },
        })
        const good = yield* capture(() => goodSdk.file.read({ path: "hello.txt" }))

        return {
          statuses: statuses({ missing, bad, good }),
          content: record(good.data).content,
        }
      }),
  )

  serverPathParity("matches generated SDK instance read routes", (serverPath) =>
    withProject(serverPath, { git: true, setup: writeStandardFiles }, ({ sdk, directory }) =>
      Effect.gen(function* () {
        const project = yield* capture(() => sdk.project.current())
        const projects = yield* capture(() => sdk.project.list())
        const paths = yield* capture(() => sdk.path.get())
        const config = yield* capture(() => sdk.config.get())
        const providers = yield* capture(() => sdk.config.providers())
        const file = yield* capture(() => sdk.file.read({ path: "hello.txt" }))
        const files = yield* capture(() => sdk.file.list({ path: "." }))
        const fileStatus = yield* capture(() => sdk.file.status())
        const findFiles = yield* capture(() => sdk.find.files({ query: "hello", limit: 10 }))
        const findText = yield* capture(() => sdk.find.text({ pattern: "sdk-parity" }))
        const agents = yield* capture(() => sdk.app.agents())
        const skills = yield* capture(() => sdk.app.skills())
        const tools = yield* capture(() => sdk.tool.ids())
        const vcs = yield* capture(() => sdk.vcs.get())
        const formatter = yield* capture(() => sdk.formatter.status())
        const lsp = yield* capture(() => sdk.lsp.status())

        return {
          statuses: statuses({
            project,
            projects,
            paths,
            config,
            providers,
            file,
            files,
            fileStatus,
            findFiles,
            findText,
            agents,
            skills,
            tools,
            vcs,
            formatter,
            lsp,
          }),
          project: { worktreeSelected: record(project.data).worktree === directory },
          paths: { directorySelected: record(paths.data).directory === directory },
          file: record(file.data).content,
          hasProject: array(projects.data).length > 0,
          foundFile: JSON.stringify(findFiles.data).includes("hello.txt"),
          foundText: JSON.stringify(findText.data ?? null).includes("sdk-parity"),
          listedFile: JSON.stringify(files.data).includes("hello.txt"),
          vcs: { hasBranch: typeof record(vcs.data).branch === "string" },
        }
      }),
    ),
  )

  serverPathParity("matches generated SDK session lifecycle routes", (serverPath) =>
    withStandardProject(serverPath, ({ sdk }) =>
      Effect.gen(function* () {
        const parent = yield* capture(() => sdk.session.create({ title: "parent" }))
        const parentID = String(record(parent.data).id)
        const child = yield* capture(() => sdk.session.create({ title: "child", parentID }))
        const childID = String(record(child.data).id)
        const get = yield* capture(() => sdk.session.get({ sessionID: parentID }))
        const update = yield* capture(() => sdk.session.update({ sessionID: parentID, title: "renamed" }))
        const roots = yield* capture(() => sdk.session.list({ roots: true, limit: 10 }))
        const all = yield* capture(() => sdk.session.list({ roots: false, limit: 10 }))
        const children = yield* capture(() => sdk.session.children({ sessionID: parentID }))
        const todo = yield* capture(() => sdk.session.todo({ sessionID: parentID }))
        const status = yield* capture(() => sdk.session.status())
        const messages = yield* capture(() => sdk.session.messages({ sessionID: parentID }))
        const missingGet = yield* capture(() => sdk.session.get({ sessionID: "ses_missing" }))
        const missingMessages = yield* capture(() => sdk.session.messages({ sessionID: "ses_missing", limit: 2 }))
        const invalidCursor = yield* capture(() =>
          sdk.session.messages({ sessionID: parentID, limit: 2, before: "bad" }),
        )
        const deleted = yield* capture(() => sdk.session.delete({ sessionID: childID }))
        const getDeleted = yield* capture(() => sdk.session.get({ sessionID: childID }))

        return {
          statuses: statuses({
            parent,
            child,
            get,
            update,
            roots,
            all,
            children,
            todo,
            status,
            messages,
            missingGet,
            missingMessages,
            invalidCursor,
            deleted,
            getDeleted,
          }),
          getTitle: record(get.data).title,
          updatedTitle: record(update.data).title,
          rootTitles: sessionTitles(roots.data),
          allTitles: sessionTitles(all.data),
          childCount: array(children.data).length,
          todoCount: array(todo.data).length,
          messageCount: array(messages.data).length,
        }
      }),
    ),
  )

  serverPathParity("matches generated SDK session message and part routes", (serverPath) =>
    withStandardProject(serverPath, ({ sdk, directory }) =>
      Effect.gen(function* () {
        const session = yield* capture(() => sdk.session.create({ title: "messages" }))
        const sessionID = String(record(session.data).id)
        const seeded = yield* seedMessage(directory, sessionID)
        const list = yield* capture(() => sdk.session.messages({ sessionID }))
        const page = yield* capture(() => sdk.session.messages({ sessionID, limit: 1 }))
        const message = yield* capture(() => sdk.session.message({ sessionID, messageID: seeded.message.id }))
        const partUpdate = yield* capture(() =>
          sdk.part.update({
            sessionID,
            messageID: seeded.message.id,
            partID: seeded.part.id,
            part: { ...seeded.part, text: "updated message" } as NonNullable<
              Parameters<Sdk["part"]["update"]>[0]["part"]
            >,
          }),
        )
        const updated = yield* capture(() => sdk.session.message({ sessionID, messageID: seeded.message.id }))
        const partDelete = yield* capture(() =>
          sdk.part.delete({ sessionID, messageID: seeded.message.id, partID: seeded.part.id }),
        )
        const withoutPart = yield* capture(() => sdk.session.message({ sessionID, messageID: seeded.message.id }))
        const deleteMessage = yield* capture(() =>
          sdk.session.deleteMessage({ sessionID, messageID: seeded.message.id }),
        )
        const missingMessage = yield* capture(() => sdk.session.message({ sessionID, messageID: seeded.message.id }))

        return {
          statuses: statuses({
            session,
            list,
            page,
            message,
            partUpdate,
            updated,
            partDelete,
            withoutPart,
            deleteMessage,
            missingMessage,
          }),
          listCount: array(list.data).length,
          pageCount: array(page.data).length,
          initialText: firstPartText(message.data),
          updatedText: firstPartText(updated.data),
          partCountAfterDelete: array(record(withoutPart.data).parts).length,
        }
      }),
    ),
  )

  // Regression: EventV2 must publish on the same ProjectBus the /event handler
  // subscribes to, AND the /event stream must forward handler ALS/context into the
  // body-pump fiber. Drives the full SDK → /event → Session.updatePart → sync.run →
  // bus.publish → SDK subscriber path. Goes red if either the publisher uses a
  // different bus instance (Bug 2 / pre-#27825) or the stream loses context (Bug 1 /
  // pre-#27425).
  serverPathParity("streams sync-backed part updates to /event subscribers", (serverPath) =>
    withStandardProject(serverPath, ({ sdk, directory }) =>
      Effect.gen(function* () {
        const session = yield* capture(() => sdk.session.create({ title: "sync-backed part event" }))
        const sessionID = String(record(session.data).id)
        const seeded = yield* seedMessage(directory, sessionID)

        const controller = new AbortController()
        yield* Effect.addFinalizer(() => Effect.sync(() => controller.abort()))
        const events = yield* call(() => sdk.event.subscribe(undefined, { signal: controller.signal }))
        yield* Effect.addFinalizer(() =>
          call(async () => void (await events.stream.return?.(undefined))).pipe(Effect.ignore),
        )

        const ready = yield* Deferred.make<void>()
        const received = yield* Deferred.make<unknown>()

        yield* call(async () => {
          for await (const event of events.stream) {
            const payload = record(event).payload ?? event
            const type = record(payload).type
            if (type === "server.connected") {
              Deferred.doneUnsafe(ready, Effect.void)
              continue
            }
            if (type === MessageV2.Event.PartUpdated.type) {
              Deferred.doneUnsafe(received, Effect.succeed(payload))
              return
            }
          }
        }).pipe(Effect.forkScoped)

        yield* awaitWithTimeout(Deferred.await(ready), "timed out waiting for /event server.connected", "2 seconds")

        const updated = yield* capture(() =>
          sdk.part.update({
            sessionID,
            messageID: seeded.message.id,
            partID: seeded.part.id,
            part: { ...seeded.part, text: "updated via sync" } as NonNullable<
              Parameters<Sdk["part"]["update"]>[0]["part"]
            >,
          }),
        )
        expect(updated.status).toBe(200)

        const event = yield* awaitWithTimeout(
          Deferred.await(received),
          "timed out waiting for message.part.updated bus payload over /event",
          "5 seconds",
        )
        const properties = record(record(event).properties)
        expect(record(properties.part)).toMatchObject({ id: seeded.part.id, type: "text" })
        return { type: record(event).type, partType: record(properties.part).type }
      }),
    ),
  )

  serverPathParity("matches generated SDK prompt no-reply routes", (serverPath) =>
    withStandardProject(serverPath, ({ sdk }) =>
      Effect.gen(function* () {
        const session = yield* capture(() => sdk.session.create({ title: "prompt" }))
        const sessionID = String(record(session.data).id)
        const prompt = yield* capture(() =>
          sdk.session.prompt({
            sessionID,
            agent: "build",
            noReply: true,
            parts: [{ type: "text", text: "hello" }],
          }),
        )
        const asyncPrompt = yield* capture(() =>
          sdk.session.promptAsync({
            sessionID,
            agent: "build",
            noReply: true,
            parts: [{ type: "text", text: "async hello" }],
          }),
        )
        const messages = yield* capture(() => sdk.session.messages({ sessionID }))

        return {
          statuses: statuses({ session, prompt, asyncPrompt, messages }),
          promptRole: record(record(prompt.data).info).role,
          messageCount: array(messages.data).length,
          messageTexts: array(messages.data)
            .flatMap((item) => array(record(item).parts))
            .map((part) => record(part).text)
            .filter((text): text is string => typeof text === "string")
            .sort(),
        }
      }),
    ),
  )

  serverPathParity("matches generated SDK prompt streaming through fake LLM", (serverPath) =>
    withFakeLlm(serverPath, ({ sdk, llm }) =>
      Effect.gen(function* () {
        yield* llm.text("fake world", { usage: { input: 11, output: 7 } })
        const session = yield* capture(() =>
          sdk.session.create({
            title: "llm prompt",
            permission: [{ permission: "*", pattern: "*", action: "allow" }],
          }),
        )
        const sessionID = String(record(session.data).id)
        const prompt = yield* capture(() =>
          sdk.session.prompt({
            sessionID,
            agent: "build",
            model: { providerID: "test", modelID: "test-model" },
            parts: [{ type: "text", text: "hello llm" }],
          }),
        )
        const messages = yield* capture(() => sdk.session.messages({ sessionID }))
        const inputs = yield* llm.inputs

        return {
          statuses: statuses({ session, prompt, messages }),
          calls: inputs.length,
          requestedModel: inputs[0]?.model,
          responseText: JSON.stringify(prompt.data).includes("fake world"),
          persistedText: JSON.stringify(messages.data).includes("fake world"),
          userText: JSON.stringify(messages.data).includes("hello llm"),
        }
      }),
    ),
  )

  serverPathParity("executes every swarm phase through durable jobs", (serverPath) =>
    withFakeLlm(serverPath, ({ sdk, llm, directory }) =>
      Effect.gen(function* () {
        yield* llm.text("orchestrator complete")
        yield* llm.text("worker complete")
        yield* llm.text("synthesis complete")
        const swarmID = yield* createDurableSwarm({ sdk, directory, title: "Durable swarm" })
        const assigned = yield* capture(() =>
          sdk.opencodex.swarm.task.assign({
            swarmID,
            opencodeXSwarmAssignTaskInput: { prompt: "Exercise the durable runtime." },
          }),
        )
        expect(assigned.status).toBe(200)

        const completed = yield* waitForSwarm(sdk, swarmID)
        const jobResponse = yield* capture(() => sdk.opencodex.job.list())
        const jobs = array(jobResponse.data).filter((job) => record(job).swarmID === swarmID)

        expect(record(completed.data).status).toBe("completed")
        expect(jobs.map((job) => String(record(job).kind)).sort((left, right) => left.localeCompare(right))).toEqual([
          "swarm.orchestrator",
          "swarm.synthesis",
          "swarm.worker",
        ])
        expect(jobs.every((job) => record(job).status === "succeeded")).toBe(true)
        expect(
          jobs.every((job) => {
            const metadata = record(record(job).metadata)
            return typeof metadata.sessionID === "string" && typeof metadata.messageID === "string"
          }),
        ).toBe(true)
        expect((yield* llm.inputs).length).toBe(3)
      }),
    ),
  )

  for (const [phase, callCount] of [
    ["orchestrator", 1],
    ["worker", 2],
    ["synthesis", 3],
  ] as const) {
    serverPathParity(`resumes ${phase} without duplicating its prompt after reload`, (serverPath) =>
      withFakeLlm(serverPath, ({ sdk, llm, directory }) =>
        Effect.gen(function* () {
          yield* (phase === "orchestrator" ? llm.hang : llm.text("orchestrator complete"))
          if (phase === "orchestrator") yield* llm.text("orchestrator recovered")
          yield* (phase === "worker" ? llm.hang : llm.text("worker complete"))
          if (phase === "worker") yield* llm.text("worker recovered")
          yield* (phase === "synthesis" ? llm.hang : llm.text("synthesis complete"))
          if (phase === "synthesis") yield* llm.text("synthesis recovered")
          const swarmID = yield* createDurableSwarm({
            sdk,
            directory,
            title: `Restart-safe ${phase} swarm`,
          })
          const assigned = yield* capture(() =>
            sdk.opencodex.swarm.task.assign({
              swarmID,
              opencodeXSwarmAssignTaskInput: { prompt: `Survive a reload during ${phase}.` },
            }),
          )
          expect(assigned.status).toBe(200)
          yield* llm.wait(callCount)
          const store = yield* InstanceStore.Service
          yield* store.reload({ directory })

          const completed = yield* waitForSwarm(sdk, swarmID)
          const jobResponse = yield* capture(() => sdk.opencodex.job.list())
          const jobs = array(jobResponse.data).filter((job) => record(job).swarmID === swarmID)
          const restarted = jobs.find((job) => record(job).kind === `swarm.${phase}`)
          const messages = yield* capture(() =>
            sdk.session.messages({ sessionID: String(record(restarted).sessionID) }),
          )
          const promptMessages = array(messages.data).filter(
            (message) => record(record(message).info).role === "user",
          )

          expect(record(completed.data).status).toBe("completed")
          expect(jobs.filter((job) => record(job).kind === "swarm.synthesis")).toHaveLength(1)
          expect(record(restarted).attempt).toBe(2)
          expect(promptMessages).toHaveLength(1)
          expect((yield* llm.inputs).length).toBe(4)
        }),
      ),
    )
  }

  serverPathParity("synthesizes successful worker output after a partial failure", (serverPath) =>
    withFakeLlm(serverPath, ({ sdk, llm, directory }) =>
      Effect.gen(function* () {
        yield* llm.text("orchestrator complete")
        yield* llm.textMatch((hit) => JSON.stringify(hit.body).includes("Worker A"), "worker A complete")
        yield* llm.pushMatch(
          (hit) => JSON.stringify(hit.body).includes("Worker B"),
          httpError(400, { error: { message: "worker B failed" } }),
          httpError(400, { error: { message: "worker B failed again" } }),
        )
        yield* llm.textMatch(
          (hit) => JSON.stringify(hit.body).includes("synthesis agent"),
          "partial synthesis complete",
        )
        const swarmID = yield* createDurableSwarm({
          sdk,
          directory,
          title: "Partial swarm",
          workers: ["Worker A", "Worker B"],
        })
        yield* capture(() =>
          sdk.opencodex.swarm.task.assign({
            swarmID,
            opencodeXSwarmAssignTaskInput: { prompt: "Synthesize the successful worker." },
          }),
        )

        const completed = yield* waitForSwarm(sdk, swarmID)
        const jobResponse = yield* capture(() => sdk.opencodex.job.list())
        const jobs = array(jobResponse.data).filter((job) => record(job).swarmID === swarmID)
        const workers = jobs.filter((job) => record(job).kind === "swarm.worker")

        expect(record(completed.data).status).toBe("partially_failed")
        expect(workers.map((job) => record(job).status).sort()).toEqual(["failed", "succeeded"])
        expect(jobs.filter((job) => record(job).kind === "swarm.synthesis")).toHaveLength(1)
        expect((yield* llm.inputs).length).toBe(5)
      }),
    ),
  )

  serverPathParity("acknowledges active swarm cancellation before committing terminal state", (serverPath) =>
    withFakeLlm(serverPath, ({ sdk, llm, directory }) =>
      Effect.gen(function* () {
        yield* llm.hang
        const swarmID = yield* createDurableSwarm({ sdk, directory, title: "Cancellable swarm" })
        yield* capture(() =>
          sdk.opencodex.swarm.task.assign({
            swarmID,
            opencodeXSwarmAssignTaskInput: { prompt: "Wait until cancelled." },
          }),
        )
        yield* llm.wait(1)
        const requested = yield* capture(() => sdk.opencodex.swarm.cancel({ swarmID }))
        const cancelled = yield* waitForSwarm(sdk, swarmID)
        const jobResponse = yield* capture(() => sdk.opencodex.job.list())
        const jobs = array(jobResponse.data).filter((job) => record(job).swarmID === swarmID)
        const orchestrator = jobs.find((job) => record(job).kind === "swarm.orchestrator")

        expect(requested.status).toBe(200)
        expect(["cancelling", "cancelled"]).toContain(record(requested.data).status)
        expect(record(cancelled.data).status).toBe("cancelled")
        expect(jobs.every((job) => record(job).status === "cancelled")).toBe(true)
        expect(record(orchestrator).cancelRequestedAt).toBeNumber()
        expect(jobs.some((job) => ["claimed", "running"].includes(String(record(job).status)))).toBe(false)
      }),
    ),
  )

  serverPathParity("serializes concurrent swarm assignments and protects internal jobs", (serverPath) =>
    withFakeLlm(serverPath, ({ sdk, llm, directory }) =>
      Effect.gen(function* () {
        yield* llm.hang
        const swarmID = yield* createDurableSwarm({ sdk, directory, title: "Concurrent swarm" })
        const assigned = yield* Effect.all(
          ["first", "second"].map((prompt) =>
            capture(() =>
              sdk.opencodex.swarm.task.assign({
                swarmID,
                opencodeXSwarmAssignTaskInput: { prompt },
              }),
            ),
          ),
          { concurrency: "unbounded" },
        )
        expect(assigned.map((response) => response.status).toSorted()).toEqual([200, 400])
        const jobResponse = yield* capture(() => sdk.opencodex.job.list())
        const jobs = array(jobResponse.data).filter((job) => record(job).swarmID === swarmID)
        expect(jobs.filter((job) => record(job).kind === "swarm.orchestrator")).toHaveLength(1)
        expect(jobs.filter((job) => record(job).kind === "swarm.worker")).toHaveLength(1)

        const blocked = yield* capture(() =>
          sdk.opencodex.job.cancel({ jobID: String(record(jobs[0]).id) }),
        )
        expect(blocked.status).toBe(400)
        yield* llm.wait(1)
        expect((yield* capture(() => sdk.opencodex.swarm.cancel({ swarmID }))).status).toBe(200)
        expect(record((yield* waitForSwarm(sdk, swarmID)).data).status).toBe("cancelled")
      }),
    ),
  )

  serverPathParity("does not synthesize after cancellation reaches active workers", (serverPath) =>
    withFakeLlm(serverPath, ({ sdk, llm, directory }) =>
      Effect.gen(function* () {
        yield* llm.text("orchestrator complete")
        yield* llm.hang
        const swarmID = yield* createDurableSwarm({ sdk, directory, title: "Worker cancellation swarm" })
        yield* capture(() =>
          sdk.opencodex.swarm.task.assign({
            swarmID,
            opencodeXSwarmAssignTaskInput: { prompt: "Cancel during worker execution." },
          }),
        )
        yield* llm.wait(2)
        yield* capture(() => sdk.opencodex.swarm.cancel({ swarmID }))
        const cancelled = yield* waitForSwarm(sdk, swarmID)
        const jobResponse = yield* capture(() => sdk.opencodex.job.list())
        const jobs = array(jobResponse.data).filter((job) => record(job).swarmID === swarmID)

        expect(record(cancelled.data).status).toBe("cancelled")
        expect(jobs.filter((job) => record(job).kind === "swarm.synthesis")).toHaveLength(0)
        expect(jobs.some((job) => ["queued", "claimed", "running"].includes(String(record(job).status)))).toBe(false)
      }),
    ),
  )

  httpapi(
    "includes project skills in REST API prompt context",
    withFakeLlmProject("default", { setup: writeProjectSkill }, ({ sdk, llm }) =>
      Effect.gen(function* () {
        yield* llm.text("skill context ok", { usage: { input: 11, output: 7 } })
        const session = yield* capture(() =>
          sdk.session.create({
            title: "project skill prompt",
            permission: [{ permission: "*", pattern: "*", action: "allow" }],
          }),
        )
        const sessionID = String(record(session.data).id)
        const prompt = yield* capture(() =>
          sdk.session.prompt({
            sessionID,
            agent: "build",
            model: { providerID: "test", modelID: "test-model" },
            parts: [{ type: "text", text: "hello skill context" }],
          }),
        )
        const inputs = yield* llm.inputs

        expect(session.status).toBe(200)
        expect(prompt.status).toBe(200)
        expect(JSON.stringify(inputs[0])).toContain("project-rest-skill")
      }),
    ),
  )

  serverPathParity("matches generated SDK TUI validation and command routes", (serverPath) =>
    withStandardProject(serverPath, ({ sdk }) =>
      Effect.gen(function* () {
        const session = yield* capture(() => sdk.session.create({ title: "tui" }))
        const sessionID = String(record(session.data).id)
        const appendPrompt = yield* capture(() => sdk.tui.appendPrompt({ text: "hello" }))
        const openHelp = yield* capture(() => sdk.tui.openHelp())
        const openSessions = yield* capture(() => sdk.tui.openSessions())
        const openThemes = yield* capture(() => sdk.tui.openThemes())
        const openModels = yield* capture(() => sdk.tui.openModels())
        const submitPrompt = yield* capture(() => sdk.tui.submitPrompt())
        const clearPrompt = yield* capture(() => sdk.tui.clearPrompt())
        const executeCommand = yield* capture(() => sdk.tui.executeCommand({ command: "session_new" }))
        const showToast = yield* capture(() => sdk.tui.showToast({ title: "SDK", message: "hello", variant: "info" }))
        const selectSession = yield* capture(() => sdk.tui.selectSession({ sessionID }))
        const missingSession = yield* capture(() => sdk.tui.selectSession({ sessionID: "ses_missing" }))
        const invalidSession = yield* capture(() => sdk.tui.selectSession({ sessionID: "invalid_session_id" }))

        return {
          statuses: statuses({
            session,
            appendPrompt,
            openHelp,
            openSessions,
            openThemes,
            openModels,
            submitPrompt,
            clearPrompt,
            executeCommand,
            showToast,
            selectSession,
            missingSession,
            invalidSession,
          }),
          data: {
            appendPrompt: appendPrompt.data,
            openHelp: openHelp.data,
            openSessions: openSessions.data,
            openThemes: openThemes.data,
            openModels: openModels.data,
            submitPrompt: submitPrompt.data,
            clearPrompt: clearPrompt.data,
            executeCommand: executeCommand.data,
            showToast: showToast.data,
            selectSession: selectSession.data,
          },
        }
      }),
    ),
  )

  serverPathParity("matches generated SDK project git initialization", (serverPath) =>
    withProject(serverPath, {}, ({ sdk, directory }) =>
      Effect.gen(function* () {
        const before = yield* capture(() => sdk.project.current())
        const init = yield* capture(() => sdk.project.initGit())
        const after = yield* capture(() => sdk.project.current())

        return {
          statuses: statuses({ before, init, after }),
          before: {
            vcs: record(before.data).vcs ?? null,
            worktree: record(before.data).worktree,
          },
          init: {
            vcs: record(init.data).vcs,
            worktreeSelected: record(init.data).worktree === directory,
          },
          after: {
            vcs: record(after.data).vcs,
            worktreeSelected: record(after.data).worktree === directory,
          },
        }
      }),
    ),
  )
})
