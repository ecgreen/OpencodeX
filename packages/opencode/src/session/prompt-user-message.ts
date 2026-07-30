import path from "path"
import os from "os"
import { pathToFileURL, fileURLToPath } from "url"
import { eq } from "drizzle-orm"
import { Cause, Context, Effect, Exit, Option, Schema, Types } from "effect"
import { SessionLegacy } from "@opencode-ai/core/session/legacy"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Database } from "@opencode-ai/core/database/database"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { AgentAttachment, FileAttachment, ReferenceAttachment, Source } from "@opencode-ai/core/session/prompt"
import { SessionTable } from "@opencode-ai/core/session/sql"
import * as Log from "@opencode-ai/core/util/log"
import { NamedError } from "@opencode-ai/core/util/error"
import { Agent } from "../agent/agent"
import { ConfigMarkdown } from "@/config/markdown"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Image } from "@/image/image"
import { InstanceState } from "@/effect/instance-state"
import { LSP } from "@/lsp/lsp"
import { MCP } from "../mcp"
import { Permission } from "@/permission"
import { Plugin } from "../plugin"
import { Provider } from "@/provider/provider"
import { Reference } from "@/reference/reference"
import { Tool } from "@/tool/tool"
import { ToolRegistry } from "@/tool/registry"
import { decodeDataUrl } from "@/util/data-url"
import { Instruction } from "./instruction"
import { MessageID, PartID, SessionID } from "./schema"
import { referencePromptMetadata, referenceTextPart } from "./prompt/reference"
import type { PromptInput } from "./prompt-schema"
import * as Session from "./session"

const log = Log.create({ service: "session.prompt" })

const decodeMessageInfo = Schema.decodeUnknownExit(SessionLegacy.Info)
const decodeMessagePart = Schema.decodeUnknownExit(SessionLegacy.Part)

/** The shape every `currentModel` branch in `prompt.ts` produces. */
export type CurrentModel = {
  readonly providerID: ProviderV2.ID
  readonly modelID: ProviderV2.ModelID
  readonly variant?: string | undefined
}

export interface Deps {
  readonly agents: Context.Service.Shape<typeof Agent.Service>
  readonly database: Context.Service.Shape<typeof Database.Service>
  readonly events: Context.Service.Shape<typeof EventV2Bridge.Service>
  readonly fsys: Context.Service.Shape<typeof AppFileSystem.Service>
  readonly image: Context.Service.Shape<typeof Image.Service>
  readonly instruction: Context.Service.Shape<typeof Instruction.Service>
  readonly lsp: Context.Service.Shape<typeof LSP.Service>
  readonly mcp: Context.Service.Shape<typeof MCP.Service>
  readonly plugin: Context.Service.Shape<typeof Plugin.Service>
  readonly provider: Context.Service.Shape<typeof Provider.Service>
  readonly references: Context.Service.Shape<typeof Reference.Service>
  readonly registry: Context.Service.Shape<typeof ToolRegistry.Service>
  readonly sessions: Context.Service.Shape<typeof Session.Service>
  readonly currentModel: (sessionID: SessionID) => Effect.Effect<CurrentModel>
}

/**
 * Turning a raw prompt into the durable user message: expanding `@` mentions
 * into file/agent/reference parts, reading what those parts point at, and
 * persisting the result. Called from the `SessionPrompt` layer, which owns the
 * services this closes over.
 */
export function make(deps: Deps) {
  const {
    agents,
    database,
    events,
    fsys,
    image,
    instruction,
    lsp,
    mcp,
    plugin,
    provider,
    references,
    registry,
    sessions,
    currentModel,
  } = deps
  const { db } = database

  const resolvePromptParts = Effect.fn("SessionPrompt.resolvePromptParts")(function* (template: string) {
    const ctx = yield* InstanceState.context
    const parts: Types.DeepMutable<PromptInput["parts"]> = [{ type: "text", text: template }]
    const files = ConfigMarkdown.files(template)
    const seen = new Set<string>()
    const mentionSource = (match: RegExpMatchArray) => {
      const start = match.index ?? 0
      return { value: match[0], start, end: start + match[0].length }
    }
    yield* Effect.forEach(
      files,
      Effect.fnUntraced(function* (match) {
        const name = match[1]
        if (!name) return
        if (seen.has(name)) return
        seen.add(name)

        const slash = name.indexOf("/")
        const alias = slash === -1 ? name : name.slice(0, slash)
        const reference = yield* references.get(alias)
        if (reference) {
          const source = mentionSource(match)
          if (reference.kind === "invalid") {
            parts.push(
              referenceTextPart({ reference, source, target: slash === -1 ? undefined : name.slice(slash + 1) }),
            )
            return
          }

          yield* references.ensure(reference.path)
          if (slash === -1) {
            parts.push(referenceTextPart({ reference, source }))
            return
          }

          const target = name.slice(slash + 1)
          const targetPath = path.resolve(reference.path, target)
          if (!AppFileSystem.contains(reference.path, targetPath)) {
            parts.push(
              referenceTextPart({
                reference,
                source,
                target,
                targetPath,
                problem: `Path escapes configured reference @${alias}: ${target}`,
              }),
            )
            return
          }

          const info = yield* fsys.stat(targetPath).pipe(Effect.option)
          if (Option.isNone(info)) {
            parts.push(
              referenceTextPart({
                reference,
                source,
                target,
                targetPath,
                problem: `Path does not exist inside configured reference @${alias}: ${target}`,
              }),
            )
            return
          }

          parts.push({
            type: "file",
            url: pathToFileURL(targetPath).href,
            filename: name,
            mime: info.value.type === "Directory" ? "application/x-directory" : "text/plain",
          })
          return
        }

        const filepath = name.startsWith("~/")
          ? path.join(os.homedir(), name.slice(2))
          : path.resolve(ctx.worktree, name)

        const info = yield* fsys.stat(filepath).pipe(Effect.option)
        if (Option.isNone(info)) {
          const found = yield* agents.get(name)
          if (found) parts.push({ type: "agent", name: found.name })
          return
        }
        const stat = info.value
        parts.push({
          type: "file",
          url: pathToFileURL(filepath).href,
          filename: name,
          mime: stat.type === "Directory" ? "application/x-directory" : "text/plain",
        })
      }),
      { concurrency: "unbounded", discard: true },
    )
    return parts
  })

  const createUserMessage = Effect.fn("SessionPrompt.createUserMessage")(function* (input: PromptInput) {
    const instance = yield* InstanceState.context
    const workspaceID = yield* InstanceState.workspaceID
    const agentName = input.agent
    const ag = agentName ? yield* agents.get(agentName) : yield* agents.defaultInfo()
    if (!ag) {
      const available = (yield* agents.list()).filter((a) => !a.hidden).map((a) => a.name)
      const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
      const error = new NamedError.Unknown({ message: `Agent not found: "${agentName}".${hint}` })
      yield* events.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() })
      throw error
    }

    const current = yield* db
      .select({ agent: SessionTable.agent, model: SessionTable.model })
      .from(SessionTable)
      .where(eq(SessionTable.id, input.sessionID))
      .get()
      .pipe(Effect.orDie)
    const model = input.model ?? ag.model ?? (yield* currentModel(input.sessionID))
    const same = ag.model && model.providerID === ag.model.providerID && model.modelID === ag.model.modelID
    const full =
      !input.variant && ag.variant && same
        ? yield* provider
            .getModel(model.providerID, model.modelID)
            .pipe(Effect.catchIf(Provider.ModelNotFoundError.isInstance, () => Effect.succeed(undefined)))
        : undefined
    const variant = input.variant ?? (ag.variant && full?.variants?.[ag.variant] ? ag.variant : undefined)

    const info: SessionLegacy.User = {
      id: input.messageID ?? MessageID.ascending(),
      role: "user",
      sessionID: input.sessionID,
      time: { created: Date.now() },
      tools: input.tools,
      agent: ag.name,
      model: {
        providerID: model.providerID,
        modelID: model.modelID,
        variant,
      },
      system: input.system,
      format: input.format,
    }
    yield* sessions.setModel({
      sessionID: input.sessionID,
      model: {
        providerID: info.model.providerID,
        id: info.model.modelID,
        ...(info.model.variant ? { variant: info.model.variant } : {}),
      },
    })

    yield* Effect.addFinalizer(() => instruction.clear(info.id))

    type Draft<T> = T extends SessionLegacy.Part ? Omit<T, "id"> & { id?: string } : never
    const assign = (part: Draft<SessionLegacy.Part>): SessionLegacy.Part => ({
      ...part,
      id: part.id ? PartID.make(part.id) : PartID.ascending(),
    })

    const referenceContextFromFilePart = Effect.fnUntraced(function* (
      part: Extract<PromptInput["parts"][number], { type: "file" }>,
      filepath: string,
    ) {
      const name = part.filename?.replace(/#\d+(?:-\d*)?$/, "")
      if (!name) return
      const slash = name.indexOf("/")
      if (slash === -1) return

      const reference = yield* references.get(name.slice(0, slash))
      if (!reference || reference.kind === "invalid") return
      if (!AppFileSystem.contains(reference.path, filepath)) return

      const target = path.relative(reference.path, filepath).split(path.sep).join("/")
      if (!target || target.startsWith("../") || target === "..") return

      return referenceTextPart({
        reference,
        source: part.source?.text ?? { value: `@${name}`, start: 0, end: name.length + 1 },
        target,
        targetPath: filepath,
      })
    })

    const resolvePart: (part: PromptInput["parts"][number]) => Effect.Effect<Draft<SessionLegacy.Part>[]> = Effect.fn(
      "SessionPrompt.resolveUserPart",
    )(function* (part) {
      if (part.type === "file") {
        if (part.source?.type === "resource") {
          const { clientName, uri } = part.source
          log.info("mcp resource", { clientName, uri, mime: part.mime })
          const pieces: Draft<SessionLegacy.Part>[] = [
            {
              messageID: info.id,
              sessionID: input.sessionID,
              type: "text",
              synthetic: true,
              text: `Reading MCP resource: ${part.filename} (${uri})`,
            },
          ]
          const exit = yield* mcp.readResource(clientName, uri).pipe(Effect.exit)
          if (Exit.isSuccess(exit)) {
            const content = exit.value
            if (!content) throw new Error(`Resource not found: ${clientName}/${uri}`)
            const items = Array.isArray(content.contents) ? content.contents : [content.contents]
            for (const c of items) {
              if ("text" in c && c.text) {
                pieces.push({
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "text",
                  synthetic: true,
                  text: c.text,
                })
              } else if ("blob" in c && c.blob) {
                const mime = "mimeType" in c ? c.mimeType : part.mime
                pieces.push({
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "text",
                  synthetic: true,
                  text: `[Binary content: ${mime}]`,
                })
              }
            }
            pieces.push({ ...part, messageID: info.id, sessionID: input.sessionID })
          } else {
            const error = Cause.squash(exit.cause)
            log.error("failed to read MCP resource", { error, clientName, uri })
            const message = error instanceof Error ? error.message : String(error)
            pieces.push({
              messageID: info.id,
              sessionID: input.sessionID,
              type: "text",
              synthetic: true,
              text: `Failed to read MCP resource ${part.filename}: ${message}`,
            })
          }
          return pieces
        }
        const url = new URL(part.url)
        switch (url.protocol) {
          case "data:":
            if (part.mime === "text/plain") {
              return [
                {
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "text",
                  synthetic: true,
                  text: `Called the Read tool with the following input: ${JSON.stringify({ filePath: part.filename })}`,
                },
                {
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "text",
                  synthetic: true,
                  text: decodeDataUrl(part.url),
                },
                { ...part, messageID: info.id, sessionID: input.sessionID },
              ]
            }
            break
          case "file:": {
            log.info("file", { mime: part.mime })
            const filepath = fileURLToPath(part.url)
            const referenceContext = yield* referenceContextFromFilePart(part, filepath)
            const mime = (yield* fsys.isDir(filepath)) ? "application/x-directory" : part.mime

            const { read } = yield* registry.named()
            const execRead = (args: Parameters<typeof read.execute>[0], extra?: Tool.Context["extra"]) => {
              const controller = new AbortController()
              return read
                .execute(args, {
                  sessionID: input.sessionID,
                  directory: instance.directory,
                  workspaceID,
                  abort: controller.signal,
                  agent: input.agent!,
                  messageID: info.id,
                  extra: { bypassCwdCheck: true, ...extra },
                  messages: [],
                  metadata: () => Effect.void,
                  ask: () => Effect.void,
                })
                .pipe(Effect.onInterrupt(() => Effect.sync(() => controller.abort())))
            }

            if (mime === "text/plain") {
              let offset: number | undefined
              let limit: number | undefined
              const range = { start: url.searchParams.get("start"), end: url.searchParams.get("end") }
              if (range.start != null) {
                const filePathURI = part.url.split("?")[0]
                let start = parseInt(range.start)
                let end = range.end ? parseInt(range.end) : undefined
                if (start === end) {
                  const symbols = yield* lsp.documentSymbol(filePathURI).pipe(Effect.catch(() => Effect.succeed([])))
                  for (const symbol of symbols) {
                    let r: LSP.Range | undefined
                    if ("range" in symbol) r = symbol.range
                    else if ("location" in symbol) r = symbol.location.range
                    if (r?.start?.line && r?.start?.line === start) {
                      start = r.start.line
                      end = r?.end?.line ?? start
                      break
                    }
                  }
                }
                offset = Math.max(start, 1)
                if (end) limit = end - (offset - 1)
              }
              const args = { filePath: filepath, offset, limit }
              const pieces: Draft<SessionLegacy.Part>[] = [
                ...(referenceContext ? [{ ...referenceContext, messageID: info.id, sessionID: input.sessionID }] : []),
                {
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "text",
                  synthetic: true,
                  text: `Called the Read tool with the following input: ${JSON.stringify(args)}`,
                },
              ]
              const exit = yield* provider.getModel(info.model.providerID, info.model.modelID).pipe(
                Effect.flatMap((mdl) => execRead(args, { model: mdl })),
                Effect.exit,
              )
              if (Exit.isSuccess(exit)) {
                const result = exit.value
                pieces.push({
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "text",
                  synthetic: true,
                  text: result.output,
                })
                if (result.attachments?.length) {
                  pieces.push(
                    ...result.attachments.map((a) => ({
                      ...a,
                      synthetic: true,
                      filename: a.filename ?? part.filename,
                      messageID: info.id,
                      sessionID: input.sessionID,
                    })),
                  )
                } else {
                  pieces.push({ ...part, mime, messageID: info.id, sessionID: input.sessionID })
                }
              } else {
                const error = Cause.squash(exit.cause)
                log.error("failed to read file", { error })
                const message = error instanceof Error ? error.message : String(error)
                yield* events.publish(Session.Event.Error, {
                  sessionID: input.sessionID,
                  error: new NamedError.Unknown({ message }).toObject(),
                })
                pieces.push({
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "text",
                  synthetic: true,
                  text: `Read tool failed to read ${filepath} with the following error: ${message}`,
                })
              }
              return pieces
            }

            if (mime === "application/x-directory") {
              const args = { filePath: filepath }
              const exit = yield* execRead(args).pipe(Effect.exit)
              if (Exit.isFailure(exit)) {
                const error = Cause.squash(exit.cause)
                log.error("failed to read directory", { error })
                const message = error instanceof Error ? error.message : String(error)
                yield* events.publish(Session.Event.Error, {
                  sessionID: input.sessionID,
                  error: new NamedError.Unknown({ message }).toObject(),
                })
                return [
                  ...(referenceContext
                    ? [{ ...referenceContext, messageID: info.id, sessionID: input.sessionID }]
                    : []),
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Read tool failed to read ${filepath} with the following error: ${message}`,
                  },
                ]
              }
              return [
                ...(referenceContext ? [{ ...referenceContext, messageID: info.id, sessionID: input.sessionID }] : []),
                {
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "text",
                  synthetic: true,
                  text: `Called the Read tool with the following input: ${JSON.stringify(args)}`,
                },
                {
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "text",
                  synthetic: true,
                  text: exit.value.output,
                },
                { ...part, mime, messageID: info.id, sessionID: input.sessionID },
              ]
            }

            return [
              ...(referenceContext ? [{ ...referenceContext, messageID: info.id, sessionID: input.sessionID }] : []),
              {
                messageID: info.id,
                sessionID: input.sessionID,
                type: "text",
                synthetic: true,
                text: `Called the Read tool with the following input: {"filePath":"${filepath}"}`,
              },
              {
                id: part.id,
                messageID: info.id,
                sessionID: input.sessionID,
                type: "file",
                url:
                  `data:${mime};base64,` +
                  Buffer.from(yield* fsys.readFile(filepath).pipe(Effect.catch(Effect.die))).toString("base64"),
                mime,
                filename: part.filename!,
                source: part.source,
              },
            ]
          }
        }
      }

      if (part.type === "agent") {
        const perm = Permission.evaluate("task", part.name, ag.permission)
        const hint = perm.action === "deny" ? " . Invoked by user; guaranteed to exist." : ""
        return [
          { ...part, messageID: info.id, sessionID: input.sessionID },
          {
            messageID: info.id,
            sessionID: input.sessionID,
            type: "text",
            synthetic: true,
            text:
              " Use the above message and context to generate a prompt and call the task tool with subagent: " +
              part.name +
              hint,
          },
        ]
      }

      return [{ ...part, messageID: info.id, sessionID: input.sessionID }]
    })

    const resolvedParts = yield* Effect.forEach(input.parts, resolvePart, { concurrency: "unbounded" }).pipe(
      Effect.map((x) => x.flat().map(assign)),
    )

    yield* plugin.trigger(
      "chat.message",
      {
        sessionID: input.sessionID,
        agent: input.agent,
        model: input.model,
        messageID: input.messageID,
        variant: input.variant,
      },
      { message: info, parts: resolvedParts },
    )

    const parts = yield* Effect.forEach(resolvedParts, (part) =>
      part.type === "file" && part.mime.startsWith("image/")
        ? image.normalize(part).pipe(
            Effect.catchIf(
              (error) => error instanceof Image.ResizerUnavailableError,
              () => Effect.succeed(part),
            ),
          )
        : Effect.succeed(part),
    )

    const parsed = decodeMessageInfo(info, { errors: "all", propertyOrder: "original" })
    if (Exit.isFailure(parsed)) {
      log.error("invalid user message before save", {
        sessionID: input.sessionID,
        messageID: info.id,
        agent: info.agent,
        model: info.model,
        cause: Cause.pretty(parsed.cause),
      })
    }
    parts.forEach((part, index) => {
      const p = decodeMessagePart(part, { errors: "all", propertyOrder: "original" })
      if (Exit.isSuccess(p)) return
      log.error("invalid user part before save", {
        sessionID: input.sessionID,
        messageID: info.id,
        partID: part.id,
        partType: part.type,
        index,
        cause: Cause.pretty(p.cause),
        part,
      })
    })

    yield* sessions.updateMessage(info)
    for (const part of parts) yield* sessions.updatePart(part)
    const nextPrompt = parts.reduce(
      (result, part) => {
        if (part.type === "text") {
          if (part.synthetic) result.synthetic.push(part.text)
          else result.text.push(part.text)
          const reference = referencePromptMetadata(part.metadata?.reference)
          if (reference) {
            result.references.push(
              new ReferenceAttachment({
                name: reference.name,
                kind: reference.kind,
                uri: reference.path ? pathToFileURL(reference.path).href : undefined,
                repository: reference.repository,
                branch: reference.branch,
                target: reference.target,
                targetUri: reference.targetPath ? pathToFileURL(reference.targetPath).href : undefined,
                problem: reference.problem,
                source: new Source({
                  start: reference.source.start,
                  end: reference.source.end,
                  text: reference.source.value,
                }),
              }),
            )
          }
        }
        if (part.type === "file") {
          result.files.push(
            new FileAttachment({
              uri: part.url,
              mime: part.mime,
              name: part.filename,
              source: part.source
                ? new Source({
                    start: part.source.text.start,
                    end: part.source.text.end,
                    text: part.source.text.value,
                  })
                : undefined,
            }),
          )
        }
        if (part.type === "agent") {
          result.agents.push(
            new AgentAttachment({
              name: part.name,
              source: part.source
                ? new Source({
                    start: part.source.start,
                    end: part.source.end,
                    text: part.source.value,
                  })
                : undefined,
            }),
          )
        }
        return result
      },
      {
        text: [] as string[],
        files: [] as FileAttachment[],
        agents: [] as AgentAttachment[],
        references: [] as ReferenceAttachment[],
        synthetic: [] as string[],
      },
    )
    for (const text of nextPrompt.synthetic) {
    }

    return { info, parts }
  }, Effect.scoped)

  return { resolvePromptParts, createUserMessage }
}

export const bashRegex = /!`([^`]+)`/g
// Match [Image N] as single token, quoted strings, or non-space sequences
export const argsRegex = /(?:\[Image\s+\d+\]|"[^"]*"|'[^']*'|[^\s"']+)/gi
export const placeholderRegex = /\$(\d+)/g
export const quoteTrimRegex = /^["']|["']$/g
