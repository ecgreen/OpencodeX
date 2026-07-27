import { GuiBridge } from "@/opencodex/gui-bridge"
import { Effect, Schema } from "effect"
import path from "path"
import { Tool } from "./tool"

const EmptyParameters = Schema.Struct({})
const WorkspaceOpenParameters = Schema.Struct({
  path: Schema.String.annotate({
    description: "Workspace file to open, absolute or relative to the current workspace",
  }),
})
const BrowserNavigateParameters = Schema.Struct({
  url: Schema.String.annotate({ description: "HTTP(S) URL to open in the GUI browser" }),
})

const decodeWorkspaceOpen = decodeOutput("workspace.open", GuiBridge.WorkspaceOpenOutput)
const decodeBrowserNavigate = decodeOutput("browser.navigate", GuiBridge.BrowserNavigateOutput)
const decodeBrowserState = decodeOutput("browser.state", GuiBridge.BrowserStateOutput)
const decodeBrowserScreenshot = decodeOutput("browser.screenshot", GuiBridge.BrowserScreenshotOutput)
const decodeBrowserSnapshot = decodeOutput("browser.snapshot", GuiBridge.BrowserSnapshotOutput)

export const WorkspaceOpenTool = Tool.define(
  "workspace_open",
  Effect.gen(function* () {
    const bridge = yield* GuiBridge.Service
    return {
      description: "Open a local workspace file in the connected OpenCode GUI.",
      parameters: WorkspaceOpenParameters,
      execute: (params: typeof WorkspaceOpenParameters.Type, ctx: Tool.Context) =>
        Effect.gen(function* () {
          if (URL.canParse(params.path) && ["http:", "https:"].includes(new URL(params.path).protocol)) {
            return yield* Effect.fail(new Error("Use browser_navigate for HTTP(S) URLs."))
          }
          const target = path.resolve(ctx.directory, params.path)
          yield* ctx.ask({
            permission: "workspace_open",
            patterns: [target],
            always: [target],
            metadata: { path: target },
          })
          const output = yield* bridge.request({
            directory: ctx.directory,
            workspaceID: ctx.workspaceID,
            sessionID: ctx.sessionID,
            operation: "workspace.open",
            input: { path: target },
          })
          const result = yield* decodeWorkspaceOpen(output)
          return {
            title: `Opened ${result.path}`,
            output: `Opened workspace: ${result.path}`,
            metadata: { path: result.path },
          }
        }),
    }
  }),
)

export const BrowserNavigateTool = Tool.define(
  "browser_navigate",
  Effect.gen(function* () {
    const bridge = yield* GuiBridge.Service
    return {
      description: "Navigate the connected GUI browser to an HTTP(S) URL.",
      parameters: BrowserNavigateParameters,
      execute: (params: typeof BrowserNavigateParameters.Type, ctx: Tool.Context) =>
        Effect.gen(function* () {
          if (!URL.canParse(params.url)) return yield* Effect.fail(new Error("A valid HTTP(S) URL is required."))
          const url = new URL(params.url)
          if (url.protocol !== "http:" && url.protocol !== "https:") {
            return yield* Effect.fail(new Error("Only HTTP(S) URLs can be opened."))
          }
          yield* ctx.ask({
            permission: "browser_navigate",
            patterns: [url.href],
            always: [url.href],
            metadata: { url: url.href },
          })
          const output = yield* bridge.request({
            directory: ctx.directory,
            workspaceID: ctx.workspaceID,
            sessionID: ctx.sessionID,
            operation: "browser.navigate",
            input: { url: url.href },
          })
          const result = yield* decodeBrowserNavigate(output)
          return {
            title: `Navigated to ${result.url}`,
            output: `Browser navigated to ${result.url}`,
            metadata: { url: result.url },
          }
        }),
    }
  }),
)

export const BrowserScreenshotTool = Tool.define(
  "browser_screenshot",
  Effect.gen(function* () {
    const bridge = yield* GuiBridge.Service
    return {
      description: "Capture the current connected GUI browser page as a PNG attachment.",
      parameters: EmptyParameters,
      execute: (_params: typeof EmptyParameters.Type, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const expectedURL = yield* currentBrowserURL(bridge, ctx)
          yield* ctx.ask({
            permission: "browser_screenshot",
            patterns: [expectedURL],
            always: [expectedURL],
            metadata: { url: expectedURL },
          })
          const output = yield* bridge.request({
            directory: ctx.directory,
            workspaceID: ctx.workspaceID,
            sessionID: ctx.sessionID,
            operation: "browser.screenshot",
            input: { expectedURL },
          })
          const result = yield* decodeBrowserScreenshot(output)
          if (result.url !== expectedURL) {
            return yield* new GuiBridge.InvalidResponseError({
              operation: "browser.screenshot",
              detail: `captured ${result.url} instead of permitted URL ${expectedURL}`,
            })
          }
          yield* validatePng(result.dataURL)
          return {
            title: `Screenshot ${result.url}`,
            output: `Captured a screenshot of ${result.url}.`,
            metadata: { url: result.url },
            attachments: [
              {
                type: "file" as const,
                mime: "image/png",
                filename: "screenshot.png",
                url: result.dataURL,
              },
            ],
          }
        }),
    }
  }),
)

export const BrowserSnapshotTool = Tool.define(
  "browser_snapshot",
  Effect.gen(function* () {
    const bridge = yield* GuiBridge.Service
    return {
      description: "Read a bounded text/accessibility snapshot of the current connected GUI browser page.",
      parameters: EmptyParameters,
      execute: (_params: typeof EmptyParameters.Type, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const expectedURL = yield* currentBrowserURL(bridge, ctx)
          yield* ctx.ask({
            permission: "browser_snapshot",
            patterns: [expectedURL],
            always: [expectedURL],
            metadata: { url: expectedURL },
          })
          const output = yield* bridge.request({
            directory: ctx.directory,
            workspaceID: ctx.workspaceID,
            sessionID: ctx.sessionID,
            operation: "browser.snapshot",
            input: { expectedURL },
          })
          const result = yield* decodeBrowserSnapshot(output)
          if (result.url !== expectedURL) {
            return yield* new GuiBridge.InvalidResponseError({
              operation: "browser.snapshot",
              detail: `captured ${result.url} instead of permitted URL ${expectedURL}`,
            })
          }
          return {
            title: `Snapshot ${result.url}`,
            output: result.text,
            metadata: { url: result.url },
          }
        }),
    }
  }),
)

function decodeOutput<S extends Schema.Top>(operation: GuiBridge.Operation, schema: S) {
  const decode = Schema.decodeUnknownEffect(schema)
  return (output: unknown) =>
    decode(output).pipe(
      Effect.mapError((error) => new GuiBridge.InvalidResponseError({ operation, detail: String(error) })),
    )
}

function currentBrowserURL(bridge: GuiBridge.Interface, ctx: Tool.Context) {
  return Effect.gen(function* () {
    const output = yield* bridge.request({
      directory: ctx.directory,
      workspaceID: ctx.workspaceID,
      sessionID: ctx.sessionID,
      operation: "browser.state",
      input: {},
    })
    const state = yield* decodeBrowserState(output)
    if (!state.url || !URL.canParse(state.url)) {
      return yield* new GuiBridge.InvalidResponseError({
        operation: "browser.state",
        detail: "the GUI browser has no active HTTP(S) page",
      })
    }
    const url = new URL(state.url)
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return yield* new GuiBridge.InvalidResponseError({
        operation: "browser.state",
        detail: "the active page is not an HTTP(S) URL",
      })
    }
    return url.href
  })
}

function validatePng(dataURL: string) {
  return Effect.gen(function* () {
    const bytes = Buffer.from(dataURL.slice("data:image/png;base64,".length), "base64")
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    if (bytes.length <= GuiBridge.MAX_PNG_BYTES && signature.every((byte, index) => bytes[index] === byte)) return
    return yield* new GuiBridge.InvalidResponseError({
      operation: "browser.screenshot",
      detail: "PNG data is invalid or exceeds the 5 MiB limit",
    })
  })
}
