import { describe, expect, spyOn } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "path"
import { fileURLToPath, pathToFileURL } from "url"
import { Deferred, Effect, Layer } from "effect"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Config } from "@/config/config"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { LSP } from "@/lsp/lsp"
import * as LSPServer from "@/lsp/server"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { TestInstance } from "../fixture/fixture"
import { awaitWithTimeout, pollWithTimeout, testEffect } from "../lib/effect"

const lspLayer = (flags: Parameters<typeof RuntimeFlags.layer>[0] = {}) =>
  LSP.layer.pipe(
    Layer.provide(Config.defaultLayer),
    Layer.provide(RuntimeFlags.layer(flags)),
    Layer.provideMerge(EventV2Bridge.defaultLayer),
  )

const it = testEffect(Layer.mergeAll(lspLayer(), CrossSpawnSpawner.defaultLayer))
const experimentalTyIt = testEffect(
  Layer.mergeAll(lspLayer({ experimentalLspTy: true }), CrossSpawnSpawner.defaultLayer),
)
const fakeServerPath = path.join(__dirname, "../fixture/lsp/fake-lsp-server.js")
const workbenchFakeServerPath = path.join(__dirname, "fake-workbench-lsp-server.js")
const disabledDownloadIt = testEffect(
  Layer.mergeAll(lspLayer({ disableLspDownload: true }), CrossSpawnSpawner.defaultLayer),
)

describe("lsp.spawn", () => {
  it.instance(
    "provides Workbench TypeScript hover and member completion when lsp is omitted",
    () =>
      LSP.Service.use((lsp) =>
        Effect.gen(function* () {
          const dir = (yield* TestInstance).directory
          const project = path.join(dir, "packages", "app")
          const dependency = path.join(dir, "node_modules", "fixture-library", "index.d.ts")
          const file = path.join(project, "app.ts")
          const content = 'import { createThing } from "fixture-library"\nconst value = createThing()\nvalue.\n'
          yield* Effect.promise(() => Promise.all([
            mkdir(project, { recursive: true }),
            mkdir(path.dirname(dependency), { recursive: true }),
          ]))
          yield* Effect.promise(() => Promise.all([
            Bun.write(path.join(project, "bun.lock"), ""),
            Bun.write(path.join(project, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, moduleResolution: "node" } })),
            Bun.write(file, content),
            Bun.write(path.join(path.dirname(dependency), "package.json"), JSON.stringify({ name: "fixture-library", types: "index.d.ts" })),
            Bun.write(dependency, "export interface FixtureThing { answer: number; label: string }\nexport declare function createThing(): FixtureThing\n"),
          ]))

          expect(yield* lsp.workbenchPrepare(file, content)).toBe(true)
          const hover = yield* lsp.hover({ file, line: 1, character: 7, workbench: true })
          const definition = yield* pollWithTimeout(
            lsp.definition({ file, line: 1, character: 16, workbench: true }).pipe(
              Effect.map((items) => items.some((item) => {
                const uri = item.uri ?? item.targetUri
                return uri && path.normalize(fileURLToPath(uri)).toLowerCase() === path.normalize(dependency).toLowerCase()
              }) ? true : undefined),
            ),
            "TypeScript did not resolve the hoisted dependency definition",
          )
          const completion = yield* pollWithTimeout(
            lsp.completion({
              file,
              line: 2,
              character: 6,
              workbench: true,
              context: { triggerKind: 2, triggerCharacter: "." },
            }).pipe(Effect.map((items) => {
              const labels = items.map((item) => item.label)
              return labels.includes("answer") ? labels : undefined
            })),
            "TypeScript did not return member completion",
          )

          expect(hover[0]?.contents).toBeTruthy()
          expect(definition).toBe(true)
          expect(completion).toContain("answer")
          expect(completion).toContain("label")
        }),
      ),
    { config: {} },
  )

  it.instance(
    "does not spawn builtin LSP for files outside instance",
    () =>
      LSP.Service.use((lsp) =>
        Effect.gen(function* () {
          const dir = (yield* TestInstance).directory
          const spy = spyOn(LSPServer.Typescript, "spawn").mockResolvedValue(undefined)

          try {
            yield* lsp.touchFile(path.join(dir, "..", "outside.ts"))
            yield* lsp.hover({
              file: path.join(dir, "..", "hover.ts"),
              line: 0,
              character: 0,
            })
            expect(spy).toHaveBeenCalledTimes(0)
          } finally {
            spy.mockRestore()
          }
        }),
      ),
    { config: { lsp: true } },
  )

  it.instance("does not spawn builtin LSP for files inside instance when LSP is unset", () =>
    LSP.Service.use((lsp) =>
      Effect.gen(function* () {
        const dir = (yield* TestInstance).directory
        const spy = spyOn(LSPServer.Typescript, "spawn").mockResolvedValue(undefined)

        try {
          yield* lsp.hover({
            file: path.join(dir, "src", "inside.ts"),
            line: 0,
            character: 0,
          })
          expect(spy).toHaveBeenCalledTimes(0)
        } finally {
          spy.mockRestore()
        }
      }),
    ),
  )

  it.instance("activates an isolated builtin Workbench client and synchronizes unsaved content", () =>
    LSP.Service.use((lsp) =>
      Effect.gen(function* () {
        const dir = (yield* TestInstance).directory
        const file = path.join(dir, "inside.ts")
        yield* Effect.promise(() => Bun.write(file, "saved content"))
        const processHandle = () => {
          const { spawn } = require("child_process")
          return {
            process: spawn(process.execPath, [workbenchFakeServerPath], { stdio: "pipe" }),
          }
        }
        const typescript = spyOn(LSPServer.Typescript, "spawn").mockImplementation(async () => processHandle())
        const disabled = [LSPServer.ESLint, LSPServer.Oxlint, LSPServer.Biome].map((server) =>
          spyOn(server, "spawn").mockResolvedValue(undefined),
        )

        try {
          expect(yield* lsp.workbenchPrepare(file, "unsaved content")).toBe(true)
          expect(typescript).toHaveBeenCalledTimes(1)

          expect(yield* lsp.hover({ file, line: 0, character: 2 })).toEqual([])
          expect(yield* lsp.hover({ file, line: 0, character: 2, workbench: true })).toEqual([
            { contents: { kind: "markdown", value: "unsaved content" } },
          ])
          expect(yield* lsp.definition({ file, line: 0, character: 2, workbench: true })).toEqual([
            {
              uri: pathToFileURL(file).href,
              range: { start: { line: 0, character: 2 }, end: { line: 0, character: 2 } },
            },
          ])
          expect(
            yield* lsp.completion({
              file,
              line: 0,
              character: 2,
              workbench: true,
              context: { triggerKind: 2, triggerCharacter: "." },
            }),
          ).toEqual([
            {
              label: "workbenchCompletion",
              detail: "unsaved content",
              data: { triggerKind: 2, triggerCharacter: "." },
            },
          ])

          expect(yield* lsp.workbenchPrepare(file, "new unsaved content")).toBe(true)
          expect(yield* lsp.hover({ file, line: 0, character: 0, workbench: true })).toEqual([
            { contents: { kind: "markdown", value: "new unsaved content" } },
          ])
        } finally {
          typescript.mockRestore()
          disabled.forEach((item) => item.mockRestore())
        }
      }),
    ),
  )

  it.instance(
    "does not activate Workbench LSP when lsp is false",
    () =>
      LSP.Service.use((lsp) =>
        Effect.gen(function* () {
          const file = path.join((yield* TestInstance).directory, "inside.ts")
          const typescript = spyOn(LSPServer.Typescript, "spawn").mockResolvedValue(undefined)
          try {
            expect(yield* lsp.workbenchPrepare(file, "unsaved content")).toBe(false)
            expect(typescript).toHaveBeenCalledTimes(0)
          } finally {
            typescript.mockRestore()
          }
        }),
      ),
    { config: { lsp: false } },
  )

  it.instance(
    "would spawn builtin LSP for files inside instance when lsp is true",
    () =>
      LSP.Service.use((lsp) =>
        Effect.gen(function* () {
          const dir = (yield* TestInstance).directory
          const spy = spyOn(LSPServer.Typescript, "spawn").mockResolvedValue(undefined)

          try {
            yield* lsp.hover({
              file: path.join(dir, "src", "inside.ts"),
              line: 0,
              character: 0,
            })
            expect(spy).toHaveBeenCalledTimes(1)
          } finally {
            spy.mockRestore()
          }
        }),
      ),
    { config: { lsp: true } },
  )

  it.instance(
    "publishes lsp.updated after custom LSP initialization",
    () =>
      Effect.gen(function* () {
        const dir = (yield* TestInstance).directory
        const lsp = yield* LSP.Service
        const updated = yield* Deferred.make<void>()
        const events = yield* EventV2Bridge.Service
        const unsubscribe = yield* events.listen((event) => {
          if (event.type === LSP.Event.Updated.type) Deferred.doneUnsafe(updated, Effect.void)
          return Effect.void
        })
        yield* Effect.addFinalizer(() => unsubscribe)

        const file = path.join(dir, "sample.repro")
        yield* Effect.promise(() => Bun.write(file, "sample\n"))
        yield* lsp.touchFile(file)
        yield* awaitWithTimeout(Deferred.await(updated), "lsp.updated event was not published")
      }),
    {
      config: {
        lsp: {
          fake: {
            command: [process.execPath, fakeServerPath],
            extensions: [".repro"],
          },
        },
      },
    },
  )

  it.instance(
    "would spawn builtin LSP for files inside instance when config object is provided",
    () =>
      LSP.Service.use((lsp) =>
        Effect.gen(function* () {
          const dir = (yield* TestInstance).directory
          const spy = spyOn(LSPServer.Typescript, "spawn").mockResolvedValue(undefined)

          try {
            yield* lsp.hover({
              file: path.join(dir, "src", "inside.ts"),
              line: 0,
              character: 0,
            })
            expect(spy).toHaveBeenCalledTimes(1)
          } finally {
            spy.mockRestore()
          }
        }),
      ),
    {
      config: {
        lsp: {
          eslint: { disabled: true },
        },
      },
    },
  )

  it.instance(
    "uses pyright instead of ty by default",
    () =>
      LSP.Service.use((lsp) =>
        Effect.gen(function* () {
          const dir = (yield* TestInstance).directory
          const ty = spyOn(LSPServer.Ty, "spawn").mockResolvedValue(undefined)
          const pyright = spyOn(LSPServer.Pyright, "spawn").mockResolvedValue(undefined)

          try {
            yield* lsp.hover({
              file: path.join(dir, "src", "inside.py"),
              line: 0,
              character: 0,
            })
            expect(ty).toHaveBeenCalledTimes(0)
            expect(pyright).toHaveBeenCalledTimes(1)
          } finally {
            ty.mockRestore()
            pyright.mockRestore()
          }
        }),
      ),
    { config: { lsp: true } },
  )

  experimentalTyIt.instance(
    "uses ty instead of pyright when experimentalLspTy is enabled",
    () =>
      LSP.Service.use((lsp) =>
        Effect.gen(function* () {
          const dir = (yield* TestInstance).directory
          const ty = spyOn(LSPServer.Ty, "spawn").mockResolvedValue(undefined)
          const pyright = spyOn(LSPServer.Pyright, "spawn").mockResolvedValue(undefined)

          try {
            yield* lsp.hover({
              file: path.join(dir, "src", "inside.py"),
              line: 0,
              character: 0,
            })
            expect(ty).toHaveBeenCalledTimes(1)
            expect(pyright).toHaveBeenCalledTimes(0)
          } finally {
            ty.mockRestore()
            pyright.mockRestore()
          }
        }),
      ),
    { config: { lsp: true } },
  )

  disabledDownloadIt.instance(
    "passes disableLspDownload to builtin LSP spawn",
    () =>
      LSP.Service.use((lsp) =>
        Effect.gen(function* () {
          const dir = (yield* TestInstance).directory
          const pyright = spyOn(LSPServer.Pyright, "spawn").mockResolvedValue(undefined)

          try {
            yield* lsp.hover({
              file: path.join(dir, "src", "inside.py"),
              line: 0,
              character: 0,
            })
            expect(pyright).toHaveBeenCalledTimes(1)
            expect(pyright.mock.calls[0]?.[2]).toMatchObject({ disableLspDownload: true })
          } finally {
            pyright.mockRestore()
          }
        }),
      ),
    { config: { lsp: true } },
  )
})
