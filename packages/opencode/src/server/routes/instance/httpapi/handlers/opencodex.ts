import { OpencodeXProject } from "@/opencodex/project"
import { workbenchDiagnostics } from "@/opencodex/workbench-diagnostics"
import { workbenchGitDiffFiles, workbenchGitHistory } from "@/opencodex/workbench-git"
import { OpencodeXJob } from "@/opencodex/job"
import { OpencodeXPlugin } from "@/opencodex/plugin"
import { OpencodeXSwarm } from "@/opencodex/swarm"
import { OpencodeXSessionState } from "@/opencodex/session-state"
import { OpencodeXView } from "@/opencodex/view"
import { Config } from "@/config/config"
import { ConfigPlugin } from "@/config/plugin"
import * as ConfigPaths from "@/config/paths"
import { Permission } from "@/permission"
import { containsPath, type InstanceContext } from "@/project/instance-context"
import { Project } from "@/project/project"
import { Question } from "@/question"
import { SessionID } from "@/session/schema"
import { Session } from "@/session/session"
import { SessionStatus } from "@/session/status"
import { Database } from "@opencode-ai/core/database/database"
import { EventTable } from "@opencode-ai/core/event/sql"
import { versionedType } from "@opencode-ai/core/event"
import { Global } from "@opencode-ai/core/global"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { applyEdits, modify, parse as parseJsonc } from "jsonc-parser"
import path from "path"
import { and, asc, eq, inArray } from "drizzle-orm"
import { Effect, Option, Schema } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import {
  PluginListQuery,
  SessionSyncQuery,
  UpdateJobPayload,
  UpdateProjectPayload,
  UpdateSessionStatePayload,
  UpdateViewPayload,
  WorkbenchBridgeRegisterPayload,
  WorkbenchFileCreatePayload,
  WorkbenchFileDeletePayload,
  WorkbenchFileRenamePayload,
  WorkbenchFileWritePayload,
  WorkbenchGithubCreatePullPayload,
  WorkbenchGithubPullPayload,
  WorkbenchGitBranchPayload,
  WorkbenchGitCommitPayload,
  WorkbenchGitPathsPayload,
  WorkbenchGitStashCreatePayload,
  WorkbenchGitStashPayload,
} from "../groups/opencodex"
import { notFound, ProjectNotFoundError } from "../errors"
import * as SessionError from "./session-errors"
import { installPlugin, patchPluginConfig, readPluginManifest } from "@/plugin/install"
import { PluginLoader } from "@/plugin/loader"
import { readPluginId, readV1Plugin, resolvePluginId } from "@/plugin/shared"
import { internalTuiPlugins } from "@/cli/cmd/tui/plugin/internal"
import * as InstanceState from "@/effect/instance-state"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Filesystem } from "@/util/filesystem"
import { errorMessage } from "@/util/error"
import { Process } from "@/util/process"

function mapErrors<A, R>(effect: Effect.Effect<A, OpencodeXProject.InvalidFolderError | Project.NotFoundError, R>) {
  return effect.pipe(
    Effect.catchTag("OpencodeX.InvalidFolderError", () =>
      Effect.fail(new HttpApiError.BadRequest({})),
    ),
    Effect.catchTag("Project.NotFoundError", (error) =>
      Effect.fail(
        new ProjectNotFoundError({
          projectID: error.projectID,
          message: `Project not found: ${error.projectID}`,
        }),
      ),
    ),
  )
}

function mapProjectNotFound<A, R>(effect: Effect.Effect<A, Project.NotFoundError, R>) {
  return effect.pipe(
    Effect.catchTag("Project.NotFoundError", (error) =>
      Effect.fail(
        new ProjectNotFoundError({
          projectID: error.projectID,
          message: `Project not found: ${error.projectID}`,
        }),
      ),
    ),
  )
}

function mapSwarmCreateErrors<A, R>(effect: Effect.Effect<A, Project.NotFoundError | OpencodeXSwarm.ValidationError, R>) {
  return effect.pipe(
    Effect.catchTag("Project.NotFoundError", (error) =>
      Effect.fail(
        new ProjectNotFoundError({
          projectID: error.projectID,
          message: `Project not found: ${error.projectID}`,
        }),
      ),
    ),
    Effect.catchTag("OpencodeX.Swarm.ValidationError", () => Effect.fail(new HttpApiError.BadRequest({}))),
  )
}

function mapJobNotFound<A, R>(effect: Effect.Effect<A, OpencodeXJob.NotFoundError, R>) {
  return effect.pipe(
    Effect.catchTag("OpencodeX.Job.NotFoundError", (error) => Effect.fail(notFound(`Job not found: ${error.jobID}`))),
  )
}

function mapSwarmNotFound<A, R>(
  effect: Effect.Effect<A, OpencodeXSwarm.NotFoundError | OpencodeXSwarm.RoleNotFoundError | OpencodeXSwarm.ValidationError, R>,
) {
  return effect.pipe(
    Effect.catchTag("OpencodeX.Swarm.NotFoundError", (error) =>
      Effect.fail(notFound(`Swarm not found: ${error.swarmID}`)),
    ),
    Effect.catchTag("OpencodeX.Swarm.RoleNotFoundError", (error) =>
      Effect.fail(notFound(`Swarm role not found: ${error.roleID}`)),
    ),
    Effect.catchTag("OpencodeX.Swarm.ValidationError", () => Effect.fail(new HttpApiError.BadRequest({}))),
  )
}

function mapViewErrors<A, R>(
  effect: Effect.Effect<A, OpencodeXView.NotFoundError | OpencodeXView.ValidationError, R>,
) {
  return effect.pipe(
    Effect.catchTag("OpencodeX.View.NotFoundError", (error) =>
      Effect.fail(notFound(`View not found: ${error.viewID}`)),
    ),
    Effect.catchTag("OpencodeX.View.ValidationError", () => Effect.fail(new HttpApiError.BadRequest({}))),
  )
}

function mergeSessions(sessions: readonly Session.Info[], projects: readonly OpencodeXProject.Info[]): Session.Info[] {
  return [
    ...new Map(
      [...sessions.map(asSessionInfo), ...projects.flatMap((project) => project.sessions.map(asSessionInfo))]
        .map((session): [SessionID, Session.Info] => [session.id, session]),
    ).values(),
  ].sort((a, b) => b.time.updated - a.time.updated || String(b.id).localeCompare(String(a.id)))
}

function asSessionInfo(session: Session.Info | OpencodeXProject.Info["sessions"][number]): Session.Info {
  return stripSessionSummaryDiffs(session) as unknown as Session.Info
}

function stripSessionSummaryDiffs<T extends { summary?: { additions: number; deletions: number; files: number; diffs?: unknown } }>(session: T): T {
  if (!session.summary?.diffs) return session
  return {
    ...session,
    summary: {
      additions: session.summary.additions,
      deletions: session.summary.deletions,
      files: session.summary.files,
    },
  } as T
}

function groupBySession<T extends { sessionID: SessionID }>(items: readonly T[]) {
  return items.reduce<Record<string, T[]>>(
    (result, item) => ({
      ...result,
      [item.sessionID]: [...(result[item.sessionID] ?? []), item],
    }),
    {},
  )
}

function sessionSyncRevision(snapshot: OpencodeXSessionState.SyncSnapshot) {
  return Bun.hash(JSON.stringify(snapshot)).toString(36)
}

const decodeSessionStatus = Schema.decodeUnknownOption(SessionStatus.Info)
const sessionStatusEventType = versionedType(SessionStatus.Event.Status.type, 1)
const gitBaseArgs = [
  "--no-optional-locks",
  "-c",
  "core.autocrlf=false",
  "-c",
  "core.fsmonitor=false",
  "-c",
  "core.longpaths=true",
  "-c",
  "core.symlinks=true",
  "-c",
  "core.quotepath=false",
] as const
const guiBridgeState: {
  browserBridge?: {
    url: string
    token: string
  }
} = {}

function persistedSessionStatus(db: Database.Interface["db"], sessionIDs: readonly SessionID[]) {
  if (sessionIDs.length === 0) return Effect.succeed(new Map<SessionID, SessionStatus.Info>())
  return db
    .select({
      sessionID: EventTable.aggregate_id,
      data: EventTable.data,
    })
    .from(EventTable)
    .where(
      and(
        inArray(EventTable.aggregate_id, [...new Set(sessionIDs)]),
        eq(EventTable.type, sessionStatusEventType),
      ),
    )
    .orderBy(EventTable.aggregate_id, asc(EventTable.seq))
    .all()
    .pipe(
      Effect.orDie,
      Effect.map((rows) =>
        rows.reduce((result, row) => {
          const status = decodeSessionStatus(row.data.status)
          if (Option.isNone(status)) return result
          if (status.value.type === "idle") {
            result.delete(SessionID.make(row.sessionID))
            return result
          }
          result.set(SessionID.make(row.sessionID), status.value)
          return result
        }, new Map<SessionID, SessionStatus.Info>()),
      ),
    )
}

function sessionStatusSnapshot(
  persisted: Map<SessionID, SessionStatus.Info>,
  active: Map<SessionID, SessionStatus.Info>,
) {
  return Object.fromEntries(
    [...active.entries()]
      .reduce((result, [sessionID, status]) => {
        if (!result.has(sessionID)) result.set(sessionID, status)
        return result
      }, new Map(persisted))
      .entries()
      .toArray()
      .toSorted(([a], [b]) => a.localeCompare(b)),
  )
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input)
}

function pluginSpecifier(input: unknown) {
  if (typeof input === "string") return input
  if (!Array.isArray(input)) return
  if (typeof input[0] !== "string") return
  return input[0]
}

function normalizeTuiConfig(input: unknown) {
  if (!isRecord(input)) return {}
  if (!isRecord(input.tui)) return input
  const { tui, ...rest } = input
  return { ...tui, ...rest }
}

function enabledMap(input: unknown) {
  if (!isRecord(input)) return {}
  return Object.fromEntries(Object.entries(input).filter((item): item is [string, boolean] => typeof item[1] === "boolean"))
}

function pluginRow(input: {
  kind: OpencodeXPlugin.Kind
  pluginID?: string
  spec: string
  source: string
  scope: OpencodeXPlugin.Scope
  enabled: boolean
  active: boolean
  canToggle: boolean
  target?: string
  note?: string
}): OpencodeXPlugin.Info {
  return {
    id: `${input.kind}:${input.source}:${input.pluginID ?? input.spec}`,
    pluginID: input.pluginID ?? input.spec,
    ...input,
  }
}

function dedupePlugins(items: OpencodeXPlugin.Info[]) {
  return [...new Map(items.map((item): [string, OpencodeXPlugin.Info] => [item.id, item])).values()]
    .toSorted((a, b) =>
      (a.kind === "tui" ? 0 : 1) - (b.kind === "tui" ? 0 : 1)
      || (a.scope === "local" ? 0 : a.scope === "global" ? 1 : 2)
        - (b.scope === "local" ? 0 : b.scope === "global" ? 1 : 2)
      || a.spec.localeCompare(b.spec),
    )
}

function tuiPluginFiles(directory: string) {
  return Effect.gen(function* () {
    const projectFiles = yield* ConfigPaths.files("tui", directory).pipe(Effect.orDie)
    const directories = yield* ConfigPaths.directories(directory).pipe(Effect.orDie)
    return [
      ...new Set([
        ...ConfigPaths.fileInDirectory(Global.Path.config, "tui"),
        ...projectFiles,
        ...directories.flatMap((dir) => ConfigPaths.fileInDirectory(dir, "tui")),
      ]),
    ]
  })
}

function readTuiEnabledMap(file: string, fs: AppFileSystem.Interface) {
  return fs.readFileStringSafe(file).pipe(
    Effect.orDie,
    Effect.map((text) => {
      if (!text) return {}
      return enabledMap(normalizeTuiConfig(parseJsonc(text)).plugin_enabled)
    }),
  )
}

function existingTuiConfigFile(files: string[], fs: AppFileSystem.Interface) {
  return Effect.gen(function* () {
    const checks = yield* Effect.forEach(
      files,
      (file) => fs.readFileStringSafe(file).pipe(
        Effect.orDie,
        Effect.map((text) => ({ file, exists: text !== undefined })),
      ),
      { concurrency: "unbounded" },
    )
    return checks.find((item) => item.exists)?.file ?? files[0]
  })
}

async function resolveTuiPluginID(item: ConfigPlugin.Origin) {
  const resolved = await PluginLoader.loadExternal<{ pluginID: string; target: string; source: string }>({
    items: [item],
    kind: "tui",
    finish: async (loaded) => {
      const mod = readV1Plugin(loaded.mod as Record<string, unknown>, loaded.spec, "tui")
      if (!mod) return
      return {
        pluginID: await resolvePluginId(
          loaded.source,
          loaded.spec,
          loaded.target,
          readPluginId(mod.id, loaded.spec),
          loaded.pkg,
        ),
        target: loaded.target,
        source: loaded.source,
      }
    },
  })
  return resolved[0]
}

type TuiPluginConfigItem = {
  spec: string
  source: string
  scope: ConfigPlugin.Scope
}

function readTuiPlugins(directory: string, fs: AppFileSystem.Interface) {
  return Effect.gen(function* () {
    const files = yield* tuiPluginFiles(directory)
    const rows = yield* Effect.forEach(
      files,
      (file) =>
        fs.readFileStringSafe(file).pipe(
          Effect.orDie,
          Effect.map((text) => {
            if (!text) return [] as TuiPluginConfigItem[]
            const data = normalizeTuiConfig(parseJsonc(text))
            const plugins = Array.isArray(data.plugin) ? data.plugin : []
            return plugins.flatMap((item): TuiPluginConfigItem[] => {
              const spec = pluginSpecifier(item)
              if (!spec) return []
              const scope: ConfigPlugin.Scope = Filesystem.contains(directory, file) ? "local" : "global"
              return [
                {
                  spec,
                  source: file,
                  scope,
                },
              ]
            })
          }),
        ),
      { concurrency: "unbounded" },
    )
    return yield* Effect.forEach(
      rows.flat(),
      (item) =>
        Effect.gen(function* () {
          const resolved = yield* Effect.promise(() =>
            resolveTuiPluginID({ spec: item.spec, source: item.source, scope: item.scope }),
          ).pipe(Effect.catch(() => Effect.succeed(undefined)))
          const pluginID = resolved?.pluginID ?? item.spec
          const enabled = yield* readTuiEnabledMap(item.source, fs)
          const state = enabled[pluginID] ?? enabled[item.spec] ?? true
          return pluginRow({
            kind: "tui",
            pluginID,
            spec: item.spec,
            source: item.source,
            scope: item.scope,
            enabled: state,
            active: state,
            canToggle: true,
            target: resolved?.target,
            note: resolved
              ? "TUI plugin state applies when the TUI runtime loads this config."
              : "Configured TUI plugin could not be resolved yet; install dependencies or restart the runtime.",
          })
        }),
      { concurrency: "unbounded" },
    )
  })
}

function internalTuiPluginRows(flags: Pick<RuntimeFlags.Info, "experimentalEventSystem">, fs: AppFileSystem.Interface) {
  return Effect.gen(function* () {
    const globalTuiConfig = yield* existingTuiConfigFile(ConfigPaths.fileInDirectory(Global.Path.config, "tui"), fs)
    const enabled = yield* readTuiEnabledMap(globalTuiConfig, fs)
    return internalTuiPlugins(flags).map((item) => {
      const state = enabled[item.id] ?? item.enabled ?? true
      return pluginRow({
        kind: "tui",
        pluginID: item.id,
        spec: item.id,
        source: globalTuiConfig,
        scope: "internal",
        enabled: state,
        active: state,
        canToggle: item.id !== "internal:plugin-manager",
        target: item.id,
        note: "Built-in TUI plugin.",
      })
    })
  })
}

function serverPlugins(config: Config.Info) {
  return (config.plugin_origins ?? []).map((item) =>
    pluginRow({
      kind: "server",
      pluginID: ConfigPlugin.pluginSpecifier(item.spec),
      spec: ConfigPlugin.pluginSpecifier(item.spec),
      source: item.source,
      scope: item.scope,
      enabled: true,
      active: true,
      canToggle: false,
      note: "Server plugins are loaded by the backend; live unload is not exposed in the GUI yet.",
    }),
  )
}

function patchTuiPluginEnabled(file: string, spec: string, enabled: boolean, fs: AppFileSystem.Interface) {
  return Effect.gen(function* () {
    const before = (yield* fs.readFileStringSafe(file).pipe(Effect.orDie)) ?? "{}"
    const parsed = parseJsonc(before)
    if (parsed !== undefined && !isRecord(parsed)) {
      return yield* Effect.fail(new HttpApiError.BadRequest({}))
    }
    const next = applyEdits(
      before.trim() ? before : "{}",
      modify(before.trim() ? before : "{}", ["plugin_enabled", spec], enabled, {
        formattingOptions: {
          insertSpaces: true,
          tabSize: 2,
        },
      }),
    )
    yield* fs.writeFileString(file, next).pipe(Effect.orDie)
  })
}

function workbenchPath(input: string, instance: InstanceContext) {
  const resolved = path.resolve(path.isAbsolute(input) ? input : path.join(instance.directory, input))
  if (!containsPath(resolved, instance)) return
  return resolved
}

function workbenchCwd(instance: InstanceContext) {
  if (instance.worktree !== "/") return instance.worktree
  return instance.directory
}

function workbenchFailure(reason: string, message: string, content?: string) {
  return { ok: false, reason, message, content }
}

function workbenchSuccess(message?: string) {
  return { ok: true, message }
}

function binaryText(value: string) {
  return value.includes("\0")
}

function branchNameValid(value: string) {
  const branch = value.trim()
  if (!branch) return false
  if (branch.startsWith("-")) return false
  if (branch.includes("..")) return false
  if (branch.includes("@{")) return false
  return /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch)
}

function gitPaths(input: readonly string[]) {
  return input
    .map((item) => item.trim())
    .filter((item) => item && !item.startsWith("-"))
}

async function gitRun(args: string[], cwd: string) {
  return Process.text(["git", ...gitBaseArgs, ...args], { cwd, nothrow: true })
}

async function workbenchRunCommand(args: string[], cwd: string) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30_000)
  try {
    return await Process.run(args, { cwd, nothrow: true, abort: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

function gitResult(result: { code: number; text: string; stderr: Buffer }) {
  return {
    exitCode: result.code,
    stderr: result.stderr,
    text: () => result.text,
  }
}

async function gitBranch(cwd: string) {
  const result = await gitRun(["branch", "--show-current"], cwd)
  if (result.code !== 0) return undefined
  return result.text.trim() || undefined
}

async function gitDefaultBranch(cwd: string) {
  const result = await gitRun(["symbolic-ref", "refs/remotes/origin/HEAD", "--short"], cwd)
  if (result.code !== 0) return undefined
  const branch = result.text.trim()
  if (!branch) return undefined
  return branch.startsWith("origin/") ? branch.slice("origin/".length) : branch
}

async function gitRemoteUrl(cwd: string) {
  const result = await gitRun(["remote", "get-url", "origin"], cwd)
  if (result.code !== 0) return undefined
  return result.text.trim() || undefined
}

async function gitTracking(cwd: string) {
  const upstreamResult = await gitRun(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], cwd)
  if (upstreamResult.code !== 0) return {}
  const upstream = upstreamResult.text.trim()
  if (!upstream) return {}
  const count = await gitRun(["rev-list", "--left-right", "--count", "HEAD...@{u}"], cwd)
  if (count.code !== 0) return { upstream }
  const values = count.text.trim().split(/\s+/)
  return {
    upstream,
    ahead: Number(values[0]) || 0,
    behind: Number(values[1]) || 0,
  }
}

function gitHubWebUrl(remoteUrl: string | undefined) {
  if (!remoteUrl) return undefined
  if (remoteUrl.startsWith("https://github.com/")) return remoteUrl.replace(/\.git$/, "")
  if (remoteUrl.startsWith("http://github.com/")) return remoteUrl.replace(/^http:/, "https:").replace(/\.git$/, "")
  const ssh = /^git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/.exec(remoteUrl)
  if (ssh) return `https://github.com/${ssh[1]}`
  const sshUrl = /^ssh:\/\/git@github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/.exec(remoteUrl)
  if (sshUrl) return `https://github.com/${sshUrl[1]}`
  return undefined
}

function gitHubRepository(remoteUrl: string | undefined) {
  const webUrl = gitHubWebUrl(remoteUrl)
  if (!webUrl) return undefined
  const url = new URL(webUrl)
  const parts = url.pathname.replace(/^\/+|\/+$/g, "").split("/")
  if (parts.length !== 2) return undefined
  return {
    owner: parts[0],
    repo: parts[1],
    webUrl,
  }
}

function gitMessage(result: { text(): string; stderr: Buffer }) {
  return result.stderr.toString("utf8").trim() || result.text().trim()
}

function gitOperationResult(result: { exitCode: number; text(): string; stderr: Buffer }, success: string) {
  if (result.exitCode === 0) return workbenchSuccess(success)
  return workbenchFailure("git_failed", gitMessage(result) || "Git command failed.")
}

function parseGitStatus(text: string) {
  return text.split("\0").filter(Boolean).flatMap((item) => {
    const code = item.slice(0, 2)
    const file = item.slice(3)
    if (!file) return []
    return [{
      path: file,
      code,
      status: code === "??"
        ? "added"
        : code.includes("D")
          ? "deleted"
          : code.includes("A")
            ? "added"
            : "modified",
      staged: code !== "??" && code[0] !== " " && code[0] !== "?",
      unstaged: code === "??" || (code[1] !== " " && code[1] !== "?"),
      untracked: code === "??",
    }]
  })
}

function parseGitStashes(text: string) {
  return text.split("\x1e").filter(Boolean).flatMap((item) => {
    const [ref, hash, age, ...messageParts] = item.split("\0")
    if (!ref) return []
    return [{
      ref,
      hash,
      age,
      message: messageParts.join("\0"),
    }]
  })
}

function stashRefValid(ref: string) {
  return /^stash@\{\d+\}$/.test(ref.trim())
}

async function githubApiData(cwd: string, resource: string) {
  const repository = gitHubRepository(await gitRemoteUrl(cwd))
  if (!repository) {
    return {
      ok: false,
      message: "Add a GitHub origin remote to enable GitHub repository data. Local Git features are still available.",
    }
  }
  return fetch(`https://api.github.com/repos/${repository.owner}/${repository.repo}${resource}`, {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "OpencodeX-Workbench",
    },
  }).then(async (response) => {
    if (!response.ok) {
      return {
        ok: false,
        message: response.status === 404 || response.status === 401 || response.status === 403
          ? "GitHub did not allow API access for this repository. Browser links still work, and private repositories can use your normal browser login."
          : `GitHub returned HTTP ${response.status}.`,
      }
    }
    return {
      ok: true,
      data: await response.json(),
    }
  }).catch((error) => ({
    ok: false,
    message: errorMessage(error) || "Could not reach GitHub. Browser links and local Git operations are still available.",
  }))
}

function githubIssueRows(data: unknown) {
  if (!Array.isArray(data)) return []
  return data.filter((item): item is Record<string, unknown> =>
    typeof item === "object" && item !== null && !("pull_request" in item),
  ).map((item) => ({
    number: item.number,
    title: item.title,
    state: item.state,
    author: githubUser(item.user),
    updatedAt: item.updated_at,
    labels: item.labels,
    url: item.html_url,
  }))
}

function githubPullRows(data: unknown) {
  if (!Array.isArray(data)) return []
  return data.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null).map((item) => ({
    number: item.number,
    title: item.title,
    state: item.state,
    author: githubUser(item.user),
    updatedAt: item.updated_at,
    headRefName: githubRefName(item.head),
    baseRefName: githubRefName(item.base),
    url: item.html_url,
  }))
}

function githubUser(input: unknown) {
  if (typeof input !== "object" || input === null || !("login" in input)) return undefined
  return { login: String(input.login) }
}

function githubRefName(input: unknown) {
  if (typeof input !== "object" || input === null || !("ref" in input)) return undefined
  return String(input.ref)
}

export const opencodexHandlers = HttpApiBuilder.group(InstanceHttpApi, "opencodex", (handlers) =>
  Effect.gen(function* () {
    const service = yield* OpencodeXProject.Service
    const jobs = yield* OpencodeXJob.Service
    const swarms = yield* OpencodeXSwarm.Service
    const views = yield* OpencodeXView.Service
    const sessions = yield* Session.Service
    const status = yield* SessionStatus.Service
    const permission = yield* Permission.Service
    const question = yield* Question.Service
    const sessionState = yield* OpencodeXSessionState.Service
    const config = yield* Config.Service
    const fs = yield* AppFileSystem.Service
    const runtimeFlags = yield* RuntimeFlags.Service
    const { db } = yield* Database.Service

    const listProjects = Effect.fn("OpencodeXHttpApi.listProjects")(function* () {
      return yield* service.list()
    })

    const createProject = Effect.fn("OpencodeXHttpApi.createProject")(function* (ctx: {
      payload: OpencodeXProject.CreateInput
    }) {
      return yield* mapErrors(service.create(ctx.payload))
    })

    const validateProject = Effect.fn("OpencodeXHttpApi.validateProject")(function* (ctx: {
      payload: OpencodeXProject.ValidateInput
    }) {
      return yield* service.validate(ctx.payload)
    })

    const updateProject = Effect.fn("OpencodeXHttpApi.updateProject")(function* (ctx: {
      params: { projectID: string }
      payload: typeof UpdateProjectPayload.Type
    }) {
      return yield* mapErrors(service.update({ ...ctx.payload, projectID: ctx.params.projectID }))
    })

    const reorderProjects = Effect.fn("OpencodeXHttpApi.reorderProjects")(function* (ctx: {
      payload: OpencodeXProject.ReorderInput
    }) {
      return yield* service.reorder(ctx.payload)
    })

    const createSession = Effect.fn("OpencodeXHttpApi.createSession")(function* (ctx: {
      payload: OpencodeXProject.CreateSessionInput
    }) {
      return yield* mapErrors(service.createSession(ctx.payload))
    })

    const sessionSync = Effect.fn("OpencodeXHttpApi.sessionSync")(function* (ctx: {
      query: typeof SessionSyncQuery.Type
    }) {
      const [projects, listed, viewList, statusMap, permissions, questions] = yield* Effect.all(
        [
          service.list(),
          sessions.list({
            directory: ctx.query.scope === "project" ? undefined : ctx.query.directory,
            scope: ctx.query.scope,
            path: ctx.query.path,
            roots: ctx.query.roots,
            start: ctx.query.start,
            search: ctx.query.search,
            limit: ctx.query.limit,
          }),
          views.list(),
          status.list(),
          permission.list(),
          question.list(),
        ],
        { concurrency: "unbounded" },
      )
      const lightProjects: OpencodeXProject.Info[] = projects.map((project) => ({
        ...project,
        sessions: project.sessions.map(stripSessionSummaryDiffs),
      }))
      const lightViews: OpencodeXView.Info[] = viewList.map((view) => ({
        ...view,
        sessions: view.sessions.map(stripSessionSummaryDiffs),
      }))
      const lightSessions = mergeSessions(listed.map(stripSessionSummaryDiffs), lightProjects)
      const sessionStatus = sessionStatusSnapshot(
        yield* persistedSessionStatus(db, lightSessions.map((session) => session.id)),
        statusMap,
      )
      const sessionStates = yield* sessionState.list(lightSessions.map((session) => session.id))
      const permissionsBySession = groupBySession(permissions)
      const questionsBySession = groupBySession(questions)
      const snapshot = {
        projects: lightProjects,
        sessions: lightSessions,
        views: lightViews,
        sessionStatus,
        permissions: permissions.toSorted((a, b) => String(a.id).localeCompare(String(b.id))),
        questions: questions.toSorted((a, b) => String(a.id).localeCompare(String(b.id))),
        sessionUiState: Object.fromEntries(
          lightSessions.map((session) => [
            session.id,
            OpencodeXSessionState.deriveUiState({
              session,
              status: sessionStatus[session.id],
              permissions: permissionsBySession[session.id] ?? [],
              questions: questionsBySession[session.id] ?? [],
              state: sessionStates[session.id],
            }),
          ]),
        ),
      }
      const revision = sessionSyncRevision(snapshot)
      if (ctx.query.since === revision) return { changed: false as const, revision }
      return { changed: true as const, revision, snapshot }
    })

    const updateSessionState = Effect.fn("OpencodeXHttpApi.updateSessionState")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof UpdateSessionStatePayload.Type
    }) {
      yield* SessionError.mapStorageNotFound(sessions.get(ctx.params.sessionID))
      return yield* sessionState.update({ ...ctx.payload, sessionID: ctx.params.sessionID })
    })

    const moveSession = Effect.fn("OpencodeXHttpApi.moveSession")(function* (ctx: {
      payload: OpencodeXProject.MoveSessionInput
    }) {
      return yield* service.moveSession(ctx.payload).pipe(
        Effect.catchTag("Project.NotFoundError", (error) =>
          Effect.fail(
            new ProjectNotFoundError({
              projectID: error.projectID,
              message: `Project not found: ${error.projectID}`,
            }),
          ),
        ),
        Effect.catchTag("NotFoundError", (error) => Effect.fail(notFound(error.message))),
      )
    })

    const removeSession = Effect.fn("OpencodeXHttpApi.removeSession")(function* (ctx: {
      params: { sessionID: SessionID }
    }) {
      yield* SessionError.mapStorageNotFound(service.removeSession(ctx.params.sessionID))
      return true
    })

    const removeProject = Effect.fn("OpencodeXHttpApi.removeProject")(function* (ctx: {
      params: { projectID: string }
    }) {
      return yield* service.removeProject(ctx.params.projectID)
    })

    const listJobs = Effect.fn("OpencodeXHttpApi.listJobs")(function* () {
      return yield* jobs.list()
    })

    const listPlugins = Effect.fn("OpencodeXHttpApi.listPlugins")(function* (_ctx: {
      query: typeof PluginListQuery.Type
    }) {
      const instance = yield* InstanceState.context
      return dedupePlugins([
        ...(yield* internalTuiPluginRows(runtimeFlags, fs)),
        ...serverPlugins(yield* config.get()),
        ...(yield* readTuiPlugins(instance.directory, fs)),
      ])
    })

    const installPluginHandler = Effect.fn("OpencodeXHttpApi.installPlugin")(function* (ctx: {
      query: typeof PluginListQuery.Type
      payload: OpencodeXPlugin.InstallInput
    }) {
      const spec = ctx.payload.spec.trim()
      if (!spec) return yield* Effect.fail(new HttpApiError.BadRequest({}))
      const instance = yield* InstanceState.context
      const installed = yield* Effect.promise(() => installPlugin(spec))
      if (!installed.ok) {
        return {
          ok: false,
          message: errorMessage(installed.error) || `Failed to install ${spec}`,
          tui: false,
          server: false,
          items: [],
        }
      }
      const manifest = yield* Effect.promise(() => readPluginManifest(installed.target))
      if (!manifest.ok) {
        return {
          ok: false,
          message: manifest.code === "manifest_no_targets"
            ? `"${spec}" does not expose plugin entrypoints or oc-themes in package.json`
            : `Installed "${spec}" but failed to read ${manifest.file}`,
          tui: false,
          server: false,
          items: [],
        }
      }
      const patch = yield* Effect.promise(() =>
        patchPluginConfig({
          spec,
          targets: manifest.targets,
          force: ctx.payload.force,
          global: ctx.payload.global,
          vcs: instance.worktree && instance.worktree !== "/" ? "git" : undefined,
          worktree: instance.worktree,
          directory: instance.directory,
        }),
      )
      if (!patch.ok) {
        return {
          ok: false,
          message: patch.code === "invalid_json"
            ? `Invalid JSON in ${patch.file} (${patch.parse} at line ${patch.line}, column ${patch.col})`
            : errorMessage(patch.error),
          tui: false,
          server: false,
          items: [],
        }
      }
      yield* config.invalidate()
      return {
        ok: true,
        dir: patch.dir,
        tui: manifest.targets.some((item) => item.kind === "tui"),
        server: manifest.targets.some((item) => item.kind === "server"),
        items: patch.items,
      }
    })

    const togglePlugin = Effect.fn("OpencodeXHttpApi.togglePlugin")(function* (ctx: {
      query: typeof PluginListQuery.Type
      payload: OpencodeXPlugin.ToggleInput
    }) {
      const instance = yield* InstanceState.context
      const list = dedupePlugins([
        ...(yield* internalTuiPluginRows(runtimeFlags, fs)),
        ...serverPlugins(yield* config.get()),
        ...(yield* readTuiPlugins(instance.directory, fs)),
      ])
      const item = list.find((plugin) => plugin.id === ctx.payload.id)
      if (!item || !item.canToggle || item.kind !== "tui") return yield* Effect.fail(new HttpApiError.BadRequest({}))
      yield* patchTuiPluginEnabled(item.source, item.pluginID, ctx.payload.enabled, fs)
      const next = dedupePlugins([
        ...(yield* internalTuiPluginRows(runtimeFlags, fs)),
        ...serverPlugins(yield* config.get()),
        ...(yield* readTuiPlugins(instance.directory, fs)),
      ]).find((plugin) => plugin.id === ctx.payload.id)
      if (!next) return yield* Effect.fail(new HttpApiError.BadRequest({}))
      return next
    })

    const workbenchFileWrite = Effect.fn("OpencodeXHttpApi.workbenchFileWrite")(function* (ctx: {
      payload: typeof WorkbenchFileWritePayload.Type
    }) {
      if (binaryText(ctx.payload.content)) return workbenchFailure("binary", "Workbench writes are text-only.")
      const instance = yield* InstanceState.context
      const target = workbenchPath(ctx.payload.path, instance)
      if (!target) return workbenchFailure("escape", "Path is outside the active workspace.")
      const current = yield* fs.readFileStringSafe(target).pipe(Effect.orDie)
      if (current === undefined) return workbenchFailure("missing", "File does not exist.")
      if (binaryText(current)) return workbenchFailure("binary", "Workbench writes are text-only.")
      if (ctx.payload.previousContent !== undefined && current !== ctx.payload.previousContent) {
        return workbenchFailure("conflict", "File changed on disk. Review before saving.", current)
      }
      yield* fs.writeFileString(target, ctx.payload.content).pipe(Effect.orDie)
      return workbenchSuccess("Saved.")
    })

    const workbenchFileCreate = Effect.fn("OpencodeXHttpApi.workbenchFileCreate")(function* (ctx: {
      payload: typeof WorkbenchFileCreatePayload.Type
    }) {
      const content = ctx.payload.content ?? ""
      if (binaryText(content)) return workbenchFailure("binary", "Workbench creates text files only.")
      const instance = yield* InstanceState.context
      const target = workbenchPath(ctx.payload.path, instance)
      if (!target) return workbenchFailure("escape", "Path is outside the active workspace.")
      if (yield* fs.existsSafe(target)) return workbenchFailure("exists", "Path already exists.")
      if (ctx.payload.directory === true) {
        yield* fs.makeDirectory(target, { recursive: true }).pipe(Effect.orDie)
        return workbenchSuccess("Folder created.")
      }
      yield* fs.writeFileString(target, content).pipe(Effect.orDie)
      return workbenchSuccess("Created.")
    })

    const workbenchFileRename = Effect.fn("OpencodeXHttpApi.workbenchFileRename")(function* (ctx: {
      payload: typeof WorkbenchFileRenamePayload.Type
    }) {
      const instance = yield* InstanceState.context
      const from = workbenchPath(ctx.payload.from, instance)
      const to = workbenchPath(ctx.payload.to, instance)
      if (!from || !to) return workbenchFailure("escape", "Path is outside the active workspace.")
      if (!(yield* fs.existsSafe(from))) return workbenchFailure("missing", "Source file does not exist.")
      if (yield* fs.existsSafe(to)) return workbenchFailure("exists", "Target already exists.")
      yield* fs.rename(from, to).pipe(Effect.orDie)
      return workbenchSuccess("Renamed.")
    })

    const workbenchFileDelete = Effect.fn("OpencodeXHttpApi.workbenchFileDelete")(function* (ctx: {
      payload: typeof WorkbenchFileDeletePayload.Type
    }) {
      const instance = yield* InstanceState.context
      const target = workbenchPath(ctx.payload.path, instance)
      if (!target) return workbenchFailure("escape", "Path is outside the active workspace.")
      if (!(yield* fs.existsSafe(target))) return workbenchFailure("missing", "File does not exist.")
      if (yield* fs.isDir(target)) return workbenchFailure("directory", "Directory deletion is not supported in the preview Workbench.")
      yield* fs.remove(target).pipe(Effect.orDie)
      return workbenchSuccess("Deleted.")
    })

    const workbenchGitStatus = Effect.fn("OpencodeXHttpApi.workbenchGitStatus")(function* () {
      const cwd = workbenchCwd(yield* InstanceState.context)
      const status = gitResult(yield* Effect.promise(() => gitRun(["status", "--porcelain=v1", "--untracked-files=all", "--no-renames", "-z", "--", "."], cwd)))
      if (status.exitCode !== 0) {
        return { ok: false, message: gitMessage(status) || "Not a Git repository.", clean: true, files: [] }
      }
      const branch = yield* Effect.promise(() => gitBranch(cwd))
      const defaultBranch = yield* Effect.promise(() => gitDefaultBranch(cwd))
      const remoteUrl = yield* Effect.promise(() => gitRemoteUrl(cwd))
      const tracking = yield* Effect.promise(() => gitTracking(cwd))
      const files = parseGitStatus(status.text())
      return {
        ok: true,
        branch,
        defaultBranch,
        ...tracking,
        remote: remoteUrl ? "origin" : undefined,
        remoteUrl,
        githubUrl: gitHubWebUrl(remoteUrl),
        clean: files.length === 0,
        files,
      }
    })

    const workbenchGitBranches = Effect.fn("OpencodeXHttpApi.workbenchGitBranches")(function* () {
      const cwd = workbenchCwd(yield* InstanceState.context)
      const list = gitResult(yield* Effect.promise(() => gitRun(["branch", "--format=%(refname:short)"], cwd)))
      if (list.exitCode !== 0) return { ok: false, message: gitMessage(list) || "Could not list branches.", branches: [] }
      return {
        ok: true,
        current: yield* Effect.promise(() => gitBranch(cwd)),
        branches: list.text().split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
      }
    })

    const workbenchGitDiff = Effect.fn("OpencodeXHttpApi.workbenchGitDiff")(function* () {
      const cwd = workbenchCwd(yield* InstanceState.context)
      return yield* Effect.promise(() => workbenchGitDiffFiles(cwd, gitRun))
    })

    const workbenchGitHistoryEndpoint = Effect.fn("OpencodeXHttpApi.workbenchGitHistory")(function* () {
      const cwd = workbenchCwd(yield* InstanceState.context)
      return yield* Effect.promise(() => workbenchGitHistory(cwd, gitRun))
    })

    const workbenchDiagnosticsEndpoint = Effect.fn("OpencodeXHttpApi.workbenchDiagnostics")(function* () {
      const cwd = workbenchCwd(yield* InstanceState.context)
      return yield* Effect.promise(() => workbenchDiagnostics(cwd, workbenchRunCommand))
    })

    const workbenchGitCheckout = Effect.fn("OpencodeXHttpApi.workbenchGitCheckout")(function* (ctx: {
      payload: typeof WorkbenchGitBranchPayload.Type
    }) {
      if (!branchNameValid(ctx.payload.branch)) return workbenchFailure("invalid_branch", "Invalid branch name.")
      const cwd = workbenchCwd(yield* InstanceState.context)
      const result = gitResult(yield* Effect.promise(() => gitRun(["checkout", ctx.payload.branch.trim()], cwd)))
      return gitOperationResult(result, "Checked out branch.")
    })

    const workbenchGitCreateBranch = Effect.fn("OpencodeXHttpApi.workbenchGitCreateBranch")(function* (ctx: {
      payload: typeof WorkbenchGitBranchPayload.Type
    }) {
      if (!branchNameValid(ctx.payload.branch)) return workbenchFailure("invalid_branch", "Invalid branch name.")
      const cwd = workbenchCwd(yield* InstanceState.context)
      const result = gitResult(yield* Effect.promise(() => gitRun(["checkout", "-b", ctx.payload.branch.trim()], cwd)))
      return gitOperationResult(result, "Created branch.")
    })

    const workbenchGitStage = Effect.fn("OpencodeXHttpApi.workbenchGitStage")(function* (ctx: {
      payload: typeof WorkbenchGitPathsPayload.Type
    }) {
      const paths = gitPaths(ctx.payload.paths)
      if (paths.length === 0) return workbenchFailure("empty", "Choose at least one file.")
      const cwd = workbenchCwd(yield* InstanceState.context)
      const result = gitResult(yield* Effect.promise(() => gitRun(["add", "--", ...paths], cwd)))
      return gitOperationResult(result, "Staged files.")
    })

    const workbenchGitUnstage = Effect.fn("OpencodeXHttpApi.workbenchGitUnstage")(function* (ctx: {
      payload: typeof WorkbenchGitPathsPayload.Type
    }) {
      const paths = gitPaths(ctx.payload.paths)
      if (paths.length === 0) return workbenchFailure("empty", "Choose at least one file.")
      const cwd = workbenchCwd(yield* InstanceState.context)
      const result = gitResult(yield* Effect.promise(() => gitRun(["restore", "--staged", "--", ...paths], cwd)))
      return gitOperationResult(result, "Unstaged files.")
    })

    const workbenchGitDiscard = Effect.fn("OpencodeXHttpApi.workbenchGitDiscard")(function* (ctx: {
      payload: typeof WorkbenchGitPathsPayload.Type
    }) {
      const paths = gitPaths(ctx.payload.paths)
      if (paths.length === 0) return workbenchFailure("empty", "Choose at least one file.")
      const cwd = workbenchCwd(yield* InstanceState.context)
      const restore = gitResult(yield* Effect.promise(() => gitRun(["restore", "--worktree", "--", ...paths], cwd)))
      if (restore.exitCode !== 0) return gitOperationResult(restore, "Discarded files.")
      const clean = gitResult(yield* Effect.promise(() => gitRun(["clean", "-f", "--", ...paths], cwd)))
      return gitOperationResult(clean, "Discarded files.")
    })

    const workbenchGitCommit = Effect.fn("OpencodeXHttpApi.workbenchGitCommit")(function* (ctx: {
      payload: typeof WorkbenchGitCommitPayload.Type
    }) {
      const message = ctx.payload.message.trim()
      if (!message) return workbenchFailure("empty", "Commit message is required.")
      const body = ctx.payload.body?.trim()
      const cwd = workbenchCwd(yield* InstanceState.context)
      const result = gitResult(yield* Effect.promise(() =>
        gitRun(["commit", "--no-gpg-sign", "-m", message, ...(body ? ["-m", body] : [])], cwd),
      ))
      return gitOperationResult(result, "Committed changes.")
    })

    const workbenchGitFetch = Effect.fn("OpencodeXHttpApi.workbenchGitFetch")(function* () {
      const cwd = workbenchCwd(yield* InstanceState.context)
      const result = gitResult(yield* Effect.promise(() => gitRun(["fetch", "--all", "--prune"], cwd)))
      return gitOperationResult(result, "Fetched remotes.")
    })

    const workbenchGitPull = Effect.fn("OpencodeXHttpApi.workbenchGitPull")(function* () {
      const cwd = workbenchCwd(yield* InstanceState.context)
      const result = gitResult(yield* Effect.promise(() => gitRun(["pull", "--ff-only"], cwd)))
      return gitOperationResult(result, "Pulled current branch.")
    })

    const workbenchGitPush = Effect.fn("OpencodeXHttpApi.workbenchGitPush")(function* () {
      const cwd = workbenchCwd(yield* InstanceState.context)
      const result = gitResult(yield* Effect.promise(() => gitRun(["push"], cwd)))
      return gitOperationResult(result, "Pushed current branch.")
    })

    const workbenchGitPublish = Effect.fn("OpencodeXHttpApi.workbenchGitPublish")(function* () {
      const cwd = workbenchCwd(yield* InstanceState.context)
      const branch = yield* Effect.promise(() => gitBranch(cwd))
      if (!branch || !branchNameValid(branch)) return workbenchFailure("invalid_branch", "Checkout a named branch before publishing.")
      const result = gitResult(yield* Effect.promise(() => gitRun(["push", "--set-upstream", "origin", branch], cwd)))
      return gitOperationResult(result, `Published ${branch}.`)
    })

    const workbenchGitStashes = Effect.fn("OpencodeXHttpApi.workbenchGitStashes")(function* () {
      const cwd = workbenchCwd(yield* InstanceState.context)
      const result = gitResult(yield* Effect.promise(() => gitRun(["stash", "list", "--format=%gd%x00%H%x00%cr%x00%s%x1e"], cwd)))
      if (result.exitCode !== 0) return { ok: false, message: gitMessage(result) || "Could not list Git stashes.", data: [] }
      return {
        ok: true,
        data: parseGitStashes(result.text()),
      }
    })

    const workbenchGitStashCreate = Effect.fn("OpencodeXHttpApi.workbenchGitStashCreate")(function* (ctx: {
      payload: typeof WorkbenchGitStashCreatePayload.Type
    }) {
      const message = ctx.payload.message?.trim() || "Workbench changes"
      const cwd = workbenchCwd(yield* InstanceState.context)
      const result = gitResult(yield* Effect.promise(() => gitRun(["stash", "push", "--include-untracked", "-m", message], cwd)))
      return gitOperationResult(result, "Stashed changes.")
    })

    const workbenchGitStashApply = Effect.fn("OpencodeXHttpApi.workbenchGitStashApply")(function* (ctx: {
      payload: typeof WorkbenchGitStashPayload.Type
    }) {
      const ref = ctx.payload.ref.trim()
      if (!stashRefValid(ref)) return workbenchFailure("invalid_stash", "Invalid stash reference.")
      const cwd = workbenchCwd(yield* InstanceState.context)
      const result = gitResult(yield* Effect.promise(() => gitRun(["stash", "apply", ref], cwd)))
      return gitOperationResult(result, `Applied ${ref}.`)
    })

    const workbenchGitStashPop = Effect.fn("OpencodeXHttpApi.workbenchGitStashPop")(function* (ctx: {
      payload: typeof WorkbenchGitStashPayload.Type
    }) {
      const ref = ctx.payload.ref.trim()
      if (!stashRefValid(ref)) return workbenchFailure("invalid_stash", "Invalid stash reference.")
      const cwd = workbenchCwd(yield* InstanceState.context)
      const result = gitResult(yield* Effect.promise(() => gitRun(["stash", "pop", ref], cwd)))
      return gitOperationResult(result, `Popped ${ref}.`)
    })

    const workbenchGitStashDrop = Effect.fn("OpencodeXHttpApi.workbenchGitStashDrop")(function* (ctx: {
      payload: typeof WorkbenchGitStashPayload.Type
    }) {
      const ref = ctx.payload.ref.trim()
      if (!stashRefValid(ref)) return workbenchFailure("invalid_stash", "Invalid stash reference.")
      const cwd = workbenchCwd(yield* InstanceState.context)
      const result = gitResult(yield* Effect.promise(() => gitRun(["stash", "drop", ref], cwd)))
      return gitOperationResult(result, `Dropped ${ref}.`)
    })

    const workbenchGithubAuth = Effect.fn("OpencodeXHttpApi.workbenchGithubAuth")(function* () {
      const cwd = workbenchCwd(yield* InstanceState.context)
      const remoteUrl = yield* Effect.promise(() => gitRemoteUrl(cwd))
      const repository = gitHubRepository(remoteUrl)
      if (!repository) {
        return {
          ok: false,
          message: "No GitHub origin remote found. Local Git features are still available.",
        }
      }
      return {
        ok: true,
        data: {
          mode: "git-remote",
          repository: repository.webUrl,
          remoteUrl,
        },
      }
    })

    const workbenchGithubRepo = Effect.fn("OpencodeXHttpApi.workbenchGithubRepo")(function* () {
      const cwd = workbenchCwd(yield* InstanceState.context)
      const result = yield* Effect.promise(() => githubApiData(cwd, ""))
      if (!result.ok) return result
      const data = typeof result.data === "object" && result.data !== null ? result.data as Record<string, unknown> : {}
      return {
        ok: true,
        data: {
          nameWithOwner: data.full_name,
          url: data.html_url,
          defaultBranchRef: typeof data.default_branch === "string" ? { name: data.default_branch } : undefined,
        },
      }
    })

    const workbenchGithubIssues = Effect.fn("OpencodeXHttpApi.workbenchGithubIssues")(function* () {
      const cwd = workbenchCwd(yield* InstanceState.context)
      const result = yield* Effect.promise(() => githubApiData(cwd, "/issues?state=open&per_page=30"))
      if (!result.ok) return result
      return {
        ok: true,
        data: githubIssueRows(result.data),
      }
    })

    const workbenchGithubPulls = Effect.fn("OpencodeXHttpApi.workbenchGithubPulls")(function* () {
      const cwd = workbenchCwd(yield* InstanceState.context)
      const result = yield* Effect.promise(() => githubApiData(cwd, "/pulls?state=open&per_page=30"))
      if (!result.ok) return result
      return {
        ok: true,
        data: githubPullRows(result.data),
      }
    })

    const workbenchGithubPull = Effect.fn("OpencodeXHttpApi.workbenchGithubPull")(function* (ctx: {
      payload: typeof WorkbenchGithubPullPayload.Type
    }) {
      const cwd = workbenchCwd(yield* InstanceState.context)
      if (!Number.isInteger(ctx.payload.number) || ctx.payload.number < 1) return { ok: false, message: "Pull request number is required." }
      const result = yield* Effect.promise(() => githubApiData(cwd, `/pulls/${ctx.payload.number}`))
      if (!result.ok) return result
      const rows = githubPullRows([result.data])
      return {
        ok: true,
        data: rows[0] ?? result.data,
      }
    })

    const workbenchGithubChecks = Effect.fn("OpencodeXHttpApi.workbenchGithubChecks")(function* (ctx: {
      payload: typeof WorkbenchGithubPullPayload.Type
    }) {
      const cwd = workbenchCwd(yield* InstanceState.context)
      if (!Number.isInteger(ctx.payload.number) || ctx.payload.number < 1) return { ok: false, message: "Pull request number is required." }
      const pull = yield* Effect.promise(() => githubApiData(cwd, `/pulls/${ctx.payload.number}`))
      if (!pull.ok) return pull
      const pullData = typeof pull.data === "object" && pull.data !== null ? pull.data as Record<string, unknown> : {}
      const head = typeof pullData.head === "object" && pullData.head !== null ? pullData.head as Record<string, unknown> : {}
      if (typeof head.sha !== "string") return { ok: false, message: "Could not find the pull request head commit." }
      return yield* Effect.promise(() => githubApiData(cwd, `/commits/${head.sha}/check-runs`))
    })

    const workbenchGithubCheckoutPull = Effect.fn("OpencodeXHttpApi.workbenchGithubCheckoutPull")(function* (ctx: {
      payload: typeof WorkbenchGithubPullPayload.Type
    }) {
      if (!Number.isInteger(ctx.payload.number) || ctx.payload.number < 1) return workbenchFailure("invalid_pull", "Pull request number is required.")
      const cwd = workbenchCwd(yield* InstanceState.context)
      const remoteUrl = yield* Effect.promise(() => gitRemoteUrl(cwd))
      if (!gitHubRepository(remoteUrl)) return workbenchFailure("no_github_remote", "Add a GitHub origin remote to checkout pull requests with Git.")
      const branch = `pr-${ctx.payload.number}`
      const fetch = gitResult(yield* Effect.promise(() => gitRun(["fetch", "origin", `pull/${ctx.payload.number}/head:${branch}`], cwd)))
      if (fetch.exitCode !== 0) return gitOperationResult(fetch, "Fetched pull request.")
      const checkout = gitResult(yield* Effect.promise(() => gitRun(["checkout", branch], cwd)))
      return gitOperationResult(checkout, `Checked out pull request #${ctx.payload.number}.`)
    })

    const workbenchGithubCreatePull = Effect.fn("OpencodeXHttpApi.workbenchGithubCreatePull")(function* (ctx: {
      payload: typeof WorkbenchGithubCreatePullPayload.Type
    }) {
      const title = ctx.payload.title.trim()
      if (!title) return { ok: false, message: "Pull request title is required." }
      const cwd = workbenchCwd(yield* InstanceState.context)
      const remoteUrl = yield* Effect.promise(() => gitRemoteUrl(cwd))
      const repository = gitHubRepository(remoteUrl)
      if (!repository) return { ok: false, message: "Add a GitHub origin remote to create pull requests." }
      const current = yield* Effect.promise(() => gitBranch(cwd))
      const base = ctx.payload.base ?? (yield* Effect.promise(() => gitDefaultBranch(cwd))) ?? "main"
      const head = ctx.payload.head ?? current
      return {
        ok: true,
        message: "Open this URL in your browser to create the pull request.",
        data: {
          title,
          url: head ? `${repository.webUrl}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}?quick_pull=1` : `${repository.webUrl}/compare`,
        },
      }
    })

    const workbenchBridgeRegister = Effect.fn("OpencodeXHttpApi.workbenchBridgeRegister")(function* (ctx: {
      payload: typeof WorkbenchBridgeRegisterPayload.Type
    }) {
      guiBridgeState.browserBridge = ctx.payload.browserBridge
      return workbenchSuccess(ctx.payload.browserBridge ? "Browser bridge registered." : "GUI bridge registered.")
    })

    const createJob = Effect.fn("OpencodeXHttpApi.createJob")(function* (ctx: {
      payload: OpencodeXJob.CreateInput
    }) {
      return yield* jobs.create(ctx.payload)
    })

    const getJob = Effect.fn("OpencodeXHttpApi.getJob")(function* (ctx: {
      params: { jobID: string }
    }) {
      return yield* mapJobNotFound(jobs.get(ctx.params.jobID))
    })

    const updateJob = Effect.fn("OpencodeXHttpApi.updateJob")(function* (ctx: {
      params: { jobID: string }
      payload: typeof UpdateJobPayload.Type
    }) {
      return yield* mapJobNotFound(jobs.update({ ...ctx.payload, id: ctx.params.jobID }))
    })

    const cancelJob = Effect.fn("OpencodeXHttpApi.cancelJob")(function* (ctx: {
      params: { jobID: string }
    }) {
      return yield* mapJobNotFound(jobs.cancel(ctx.params.jobID))
    })

    const listSwarms = Effect.fn("OpencodeXHttpApi.listSwarms")(function* () {
      return yield* swarms.list()
    })

    const createSwarm = Effect.fn("OpencodeXHttpApi.createSwarm")(function* (ctx: {
      payload: OpencodeXSwarm.CreateInput
    }) {
      return yield* mapSwarmCreateErrors(swarms.create(ctx.payload))
    })

    const getSwarm = Effect.fn("OpencodeXHttpApi.getSwarm")(function* (ctx: {
      params: { swarmID: string }
    }) {
      return yield* mapSwarmNotFound(swarms.get(ctx.params.swarmID))
    })

    const updateSwarm = Effect.fn("OpencodeXHttpApi.updateSwarm")(function* (ctx: {
      params: { swarmID: string }
      payload: OpencodeXSwarm.UpdateInput
    }) {
      return yield* mapSwarmNotFound(swarms.update(ctx.params.swarmID, ctx.payload))
    })

    const startSwarm = Effect.fn("OpencodeXHttpApi.startSwarm")(function* (ctx: {
      params: { swarmID: string }
    }) {
      return yield* mapSwarmNotFound(swarms.start(ctx.params.swarmID))
    })

    const assignSwarmTask = Effect.fn("OpencodeXHttpApi.assignSwarmTask")(function* (ctx: {
      params: { swarmID: string }
      payload: OpencodeXSwarm.AssignTaskInput
    }) {
      return yield* mapSwarmNotFound(swarms.assignTask(ctx.params.swarmID, ctx.payload))
    })

    const cancelSwarm = Effect.fn("OpencodeXHttpApi.cancelSwarm")(function* (ctx: {
      params: { swarmID: string }
    }) {
      return yield* mapSwarmNotFound(swarms.cancel(ctx.params.swarmID))
    })

    const removeSwarm = Effect.fn("OpencodeXHttpApi.removeSwarm")(function* (ctx: {
      params: { swarmID: string }
    }) {
      return yield* mapSwarmNotFound(swarms.remove(ctx.params.swarmID))
    })

    const addSwarmRole = Effect.fn("OpencodeXHttpApi.addSwarmRole")(function* (ctx: {
      params: { swarmID: string }
      payload: OpencodeXSwarm.AddRoleInput
    }) {
      return yield* mapSwarmNotFound(swarms.addRole(ctx.params.swarmID, ctx.payload))
    })

    const updateSwarmRole = Effect.fn("OpencodeXHttpApi.updateSwarmRole")(function* (ctx: {
      params: { swarmID: string; roleID: string }
      payload: OpencodeXSwarm.UpdateRoleInput
    }) {
      return yield* mapSwarmNotFound(swarms.updateRole(ctx.params.swarmID, ctx.params.roleID, ctx.payload))
    })

    const listViews = Effect.fn("OpencodeXHttpApi.listViews")(function* () {
      return yield* views.list()
    })

    const createView = Effect.fn("OpencodeXHttpApi.createView")(function* (ctx: {
      payload: OpencodeXView.CreateInput
    }) {
      return yield* views.create(ctx.payload).pipe(
        Effect.catchTag("NotFoundError", () => Effect.fail(new OpencodeXView.ValidationError({ message: "Session not found." }))),
        Effect.catchTag("OpencodeX.View.ValidationError", () => Effect.fail(new HttpApiError.BadRequest({}))),
      )
    })

    const reorderViews = Effect.fn("OpencodeXHttpApi.reorderViews")(function* (ctx: {
      payload: OpencodeXView.ReorderInput
    }) {
      return yield* views.reorder(ctx.payload)
    })

    const getView = Effect.fn("OpencodeXHttpApi.getView")(function* (ctx: {
      params: { viewID: string }
    }) {
      return yield* mapViewErrors(views.get(ctx.params.viewID))
    })

    const updateView = Effect.fn("OpencodeXHttpApi.updateView")(function* (ctx: {
      params: { viewID: string }
      payload: typeof UpdateViewPayload.Type
    }) {
      return yield* mapViewErrors(
        views
          .update({ ...ctx.payload, id: ctx.params.viewID })
          .pipe(Effect.catchTag("NotFoundError", () => Effect.fail(new OpencodeXView.ValidationError({ message: "Session not found." })))),
      )
    })

    const removeView = Effect.fn("OpencodeXHttpApi.removeView")(function* (ctx: {
      params: { viewID: string }
    }) {
      return yield* mapViewErrors(views.remove(ctx.params.viewID))
    })

    return handlers
      .handle("listProjects", listProjects)
      .handle("createProject", createProject)
      .handle("validateProject", validateProject)
      .handle("updateProject", updateProject)
      .handle("reorderProjects", reorderProjects)
      .handle("createSession", createSession)
      .handle("sessionSync", sessionSync)
      .handle("updateSessionState", updateSessionState)
      .handle("moveSession", moveSession)
      .handle("removeSession", removeSession)
      .handle("removeProject", removeProject)
      .handle("listJobs", listJobs)
      .handle("listPlugins", listPlugins)
      .handle("installPlugin", installPluginHandler)
      .handle("togglePlugin", togglePlugin)
      .handle("workbenchFileWrite", workbenchFileWrite)
      .handle("workbenchFileCreate", workbenchFileCreate)
      .handle("workbenchFileRename", workbenchFileRename)
      .handle("workbenchFileDelete", workbenchFileDelete)
      .handle("workbenchGitStatus", workbenchGitStatus)
      .handle("workbenchGitBranches", workbenchGitBranches)
      .handle("workbenchGitDiff", workbenchGitDiff)
      .handle("workbenchGitHistory", workbenchGitHistoryEndpoint)
      .handle("workbenchDiagnostics", workbenchDiagnosticsEndpoint)
      .handle("workbenchGitCheckout", workbenchGitCheckout)
      .handle("workbenchGitCreateBranch", workbenchGitCreateBranch)
      .handle("workbenchGitStage", workbenchGitStage)
      .handle("workbenchGitUnstage", workbenchGitUnstage)
      .handle("workbenchGitDiscard", workbenchGitDiscard)
      .handle("workbenchGitCommit", workbenchGitCommit)
      .handle("workbenchGitFetch", workbenchGitFetch)
      .handle("workbenchGitPull", workbenchGitPull)
      .handle("workbenchGitPush", workbenchGitPush)
      .handle("workbenchGitPublish", workbenchGitPublish)
      .handle("workbenchGitStashes", workbenchGitStashes)
      .handle("workbenchGitStashCreate", workbenchGitStashCreate)
      .handle("workbenchGitStashApply", workbenchGitStashApply)
      .handle("workbenchGitStashPop", workbenchGitStashPop)
      .handle("workbenchGitStashDrop", workbenchGitStashDrop)
      .handle("workbenchGithubAuth", workbenchGithubAuth)
      .handle("workbenchGithubRepo", workbenchGithubRepo)
      .handle("workbenchGithubIssues", workbenchGithubIssues)
      .handle("workbenchGithubPulls", workbenchGithubPulls)
      .handle("workbenchGithubPull", workbenchGithubPull)
      .handle("workbenchGithubChecks", workbenchGithubChecks)
      .handle("workbenchGithubCheckoutPull", workbenchGithubCheckoutPull)
      .handle("workbenchGithubCreatePull", workbenchGithubCreatePull)
      .handle("workbenchBridgeRegister", workbenchBridgeRegister)
      .handle("createJob", createJob)
      .handle("getJob", getJob)
      .handle("updateJob", updateJob)
      .handle("cancelJob", cancelJob)
      .handle("listSwarms", listSwarms)
      .handle("createSwarm", createSwarm)
      .handle("getSwarm", getSwarm)
      .handle("updateSwarm", updateSwarm)
      .handle("startSwarm", startSwarm)
      .handle("assignSwarmTask", assignSwarmTask)
      .handle("cancelSwarm", cancelSwarm)
      .handle("removeSwarm", removeSwarm)
      .handle("addSwarmRole", addSwarmRole)
      .handle("updateSwarmRole", updateSwarmRole)
      .handle("listViews", listViews)
      .handle("createView", createView)
      .handle("reorderViews", reorderViews)
      .handle("getView", getView)
      .handle("updateView", updateView)
      .handle("removeView", removeView)
  }),
)
