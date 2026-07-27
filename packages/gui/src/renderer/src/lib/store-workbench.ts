import type { FileContent, FileNode } from "@opencode-ai/sdk/v2/client"
import type { GuiClient } from "./client"
import {
  WORKBENCH_PREVIEW_FILE_BYTES,
  boundedWorkbenchFile,
  type WorkbenchFileRead,
} from "./file-resource-limits"
import { authHeaders } from "./store-auth"
import {
  type GuiPlugin,
  type GuiPluginInstallResult,
  type WorkbenchDataResult,
  type WorkbenchCompletionResult,
  type WorkbenchDefinitionLocation,
  type WorkbenchDiagnosticsResult,
  type WorkbenchFileDiagnosticsResult,
  type WorkbenchFileReadResult,
  type WorkbenchGitBranches,
  type WorkbenchHoverResult,
  type WorkbenchChangePatch,
  type WorkbenchChangeMetricsPage,
  type WorkbenchChangePatchPage,
  type WorkbenchChangesPage,
  type WorkbenchGitHistoryCommit,
  type WorkbenchGitStash,
  type WorkbenchOperationResult,
} from "./store"

export async function findFiles(gui: GuiClient, input: { query: string; directory?: string; limit?: number; signal?: AbortSignal }): Promise<FileNode[]> {
  return gui.client.find.files({
    directory: input.directory || gui.directory || undefined,
    query: input.query,
    dirs: "true",
    limit: input.limit ?? 20,
  }, { headers: authHeaders(gui), throwOnError: true, signal: input.signal }).then((x) => (x.data ?? []).map((file) => typeof file === "string" ? {
    name: file.split(/[\\/]/).at(-1) ?? file,
    path: file,
    absolute: file,
    type: "file",
    ignored: false,
  } : file))
}

export async function listWorkbenchFiles(gui: GuiClient, path: string, directory?: string, signal?: AbortSignal): Promise<FileNode[]> {
  return gui.client.file.list({
    directory: directory || gui.directory || undefined,
    path,
  }, { headers: authHeaders(gui), throwOnError: true, signal }).then((x) => x.data ?? [])
}

export async function readWorkbenchFile(gui: GuiClient, path: string, directory?: string, signal?: AbortSignal, root?: string): Promise<WorkbenchFileRead | undefined> {
  if (root) {
    const exact = await exactWorkbenchFileRead(gui, path, directory, signal, root)
    if (!exact.ok) return
    return boundedWorkbenchFile({
      type: "text",
      content: exact.content ?? "",
      bytes: exact.bytes,
      truncated: exact.truncated,
    })
  }
  const received = await gui.client.file.read({
    directory: directory || gui.directory || undefined,
    path,
    maxBytes: String(WORKBENCH_PREVIEW_FILE_BYTES),
  }, { headers: authHeaders(gui), throwOnError: true, signal }).then((x) => x.data)
  if (!received) return
  const file: FileContent = received.encoding === "base64" ? { ...received, type: "binary" } : received
  const initial = boundedWorkbenchFile(file)
  if (file.type !== "text" || initial.mode === "metadata") return initial
  const exact = await exactWorkbenchFileRead(gui, path, directory, signal)
  if (exact.truncated) {
    return boundedWorkbenchFile({
      ...file,
      content: "",
      bytes: exact.bytes ?? file.bytes,
      truncated: true,
    })
  }
  return boundedWorkbenchFile(exact.ok && exact.content !== undefined ? {
    ...file,
    content: exact.content,
    bytes: exact.bytes ?? file.bytes,
    truncated: false,
  } : file)
}

function exactWorkbenchFileRead(gui: GuiClient, path: string, directory?: string, signal?: AbortSignal, root?: string) {
  return gui.client.opencodex.workbench.file.read({
    directory: directory || gui.directory || undefined,
    path,
    root,
    maxBytes: String(WORKBENCH_PREVIEW_FILE_BYTES),
  }, { headers: authHeaders(gui), throwOnError: true, signal })
    .then((result) => result.data as WorkbenchFileReadResult)
}

export function readWorkbenchTextFile(gui: GuiClient, path: string, directory: string | undefined, maxBytes: number, signal?: AbortSignal) {
  return pluginApi<WorkbenchFileReadResult>(
    gui,
    `/experimental/opencodex/workbench/file/read?path=${encodeURIComponent(path)}&maxBytes=${maxBytes}`,
    { signal },
    directory,
  )
}

export async function writeWorkbenchFile(gui: GuiClient, input: { path: string; content: string; previousContent?: string }, directory?: string): Promise<WorkbenchOperationResult> {
  return pluginApi<WorkbenchOperationResult>(gui, "/experimental/opencodex/workbench/file/write", {
    method: "POST",
    body: JSON.stringify(input),
  }, directory)
}

export async function createWorkbenchFile(gui: GuiClient, input: { path: string; content?: string; directory?: boolean }, directory?: string): Promise<WorkbenchOperationResult> {
  return pluginApi<WorkbenchOperationResult>(gui, "/experimental/opencodex/workbench/file/create", {
    method: "POST",
    body: JSON.stringify(input),
  }, directory)
}

export async function renameWorkbenchFile(gui: GuiClient, input: { from: string; to: string }, directory?: string): Promise<WorkbenchOperationResult> {
  return pluginApi<WorkbenchOperationResult>(gui, "/experimental/opencodex/workbench/file/rename", {
    method: "POST",
    body: JSON.stringify(input),
  }, directory)
}

export async function deleteWorkbenchFile(gui: GuiClient, path: string, directory?: string): Promise<WorkbenchOperationResult> {
  return pluginApi<WorkbenchOperationResult>(gui, "/experimental/opencodex/workbench/file/delete", {
    method: "POST",
    body: JSON.stringify({ path }),
  }, directory)
}

export async function workbenchGitBranches(gui: GuiClient, directory?: string): Promise<WorkbenchGitBranches> {
  return pluginApi<WorkbenchGitBranches>(gui, "/experimental/opencodex/workbench/git/branches", {}, directory)
}

export function initializeWorkbenchGit(gui: GuiClient, directory?: string, signal?: AbortSignal) {
  return gui.client.project.initGit({
    directory: directory || gui.directory || undefined,
  }, { headers: authHeaders(gui), throwOnError: true, signal }).then((result) => result.data)
}

export function workbenchChanges(
  gui: GuiClient,
  input: { directory?: string; path?: string; cursor?: string; revision?: string; limit?: number; signal?: AbortSignal } = {},
): Promise<WorkbenchChangesPage> {
  return gui.client.opencodex.workbench.changes.page({
    directory: input.directory || gui.directory || undefined,
    path: input.path,
    cursor: input.cursor,
    revision: input.revision,
    limit: input.limit === undefined ? undefined : String(input.limit),
  }, { headers: authHeaders(gui), throwOnError: true, signal: input.signal }).then((result) => result.data)
}

export function workbenchChangePatch(
  gui: GuiClient,
  input: { directory?: string; path: string; revision?: string; context?: number; maxBytes?: number; signal?: AbortSignal },
): Promise<WorkbenchChangePatch> {
  return gui.client.opencodex.workbench.changes.patch({
    directory: input.directory || gui.directory || undefined,
    path: input.path,
    revision: input.revision,
    context: input.context === undefined ? undefined : String(input.context),
    maxBytes: input.maxBytes === undefined ? undefined : String(input.maxBytes),
  }, { headers: authHeaders(gui), throwOnError: true, signal: input.signal }).then((result) => result.data)
}

export function workbenchChangeMetricsPage(
  gui: GuiClient,
  input: { directory?: string; revision: string; path?: string; cursor?: string; limit?: number; signal?: AbortSignal },
): Promise<WorkbenchChangeMetricsPage> {
  return gui.client.opencodex.workbench.changes.metricsPage({
    directory: input.directory || gui.directory || undefined,
    revision: input.revision,
    path: input.path,
    cursor: input.cursor,
    limit: input.limit === undefined ? undefined : String(input.limit),
  }, { headers: authHeaders(gui), throwOnError: true, signal: input.signal }).then((result) => result.data)
}

export function workbenchChangePatchPage(
  gui: GuiClient,
  input: { directory?: string; path: string; revision: string; cursor?: string; context?: number; signal?: AbortSignal },
): Promise<WorkbenchChangePatchPage> {
  return gui.client.opencodex.workbench.changes.patchPage({
    directory: input.directory || gui.directory || undefined,
    path: input.path,
    revision: input.revision,
    cursor: input.cursor,
    context: input.context === undefined ? undefined : String(input.context),
  }, { headers: authHeaders(gui), throwOnError: true, signal: input.signal }).then((result) => result.data)
}

export async function workbenchGitHistory(gui: GuiClient, directory?: string): Promise<WorkbenchDataResult<WorkbenchGitHistoryCommit[]>> {
  return pluginApi<WorkbenchDataResult<WorkbenchGitHistoryCommit[]>>(gui, "/experimental/opencodex/workbench/git/history", {}, directory)
}

export async function workbenchDiagnostics(gui: GuiClient, directory?: string): Promise<WorkbenchDiagnosticsResult> {
  return pluginApi<WorkbenchDiagnosticsResult>(gui, "/experimental/opencodex/workbench/diagnostics", {}, directory)
}

export function workbenchFileDiagnostics(
  gui: GuiClient,
  input: { path: string; root?: string; content: string; signal?: AbortSignal },
  directory?: string,
) {
  return gui.client.opencodex.workbench.file.diagnostics({
    directory: directory || gui.directory || undefined,
    path: input.path,
    root: input.root,
    content: input.content,
  }, { headers: authHeaders(gui), throwOnError: true, signal: input.signal })
    .then((result) => result.data as WorkbenchFileDiagnosticsResult)
}

export function workbenchFileDefinition(
  gui: GuiClient,
  input: { path: string; root?: string; content: string; line: number; column: number; signal?: AbortSignal },
  directory?: string,
) {
  return gui.client.opencodex.workbench.file.definition({
    directory: directory || gui.directory || undefined,
    path: input.path,
    root: input.root,
    content: input.content,
    line: input.line,
    column: input.column,
  }, { headers: authHeaders(gui), throwOnError: true, signal: input.signal })
    .then((result) => result.data as WorkbenchDefinitionLocation[])
}

export function workbenchFileHover(
  gui: GuiClient,
  input: { path: string; root?: string; content: string; line: number; column: number; signal?: AbortSignal },
  directory?: string,
) {
  return gui.client.opencodex.workbench.file.hover({
    directory: directory || gui.directory || undefined,
    path: input.path,
    root: input.root,
    content: input.content,
    line: input.line,
    column: input.column,
  }, { headers: authHeaders(gui), throwOnError: true, signal: input.signal })
    .then((result) => result.data as WorkbenchHoverResult)
}

export function workbenchFileCompletion(
  gui: GuiClient,
  input: {
    path: string
    root?: string
    content: string
    line: number
    column: number
    triggerKind?: 1 | 2 | 3
    triggerCharacter?: string
    signal?: AbortSignal
  },
  directory?: string,
) {
  return gui.client.opencodex.workbench.file.completion({
    directory: directory || gui.directory || undefined,
    path: input.path,
    root: input.root,
    content: input.content,
    line: input.line,
    column: input.column,
    triggerKind: input.triggerKind,
    triggerCharacter: input.triggerCharacter,
  }, { headers: authHeaders(gui), throwOnError: true, signal: input.signal })
    .then((result) => result.data as WorkbenchCompletionResult)
}

export async function workbenchGitOperation(gui: GuiClient, action: "checkout" | "create-branch", input: { branch: string }, directory?: string): Promise<WorkbenchOperationResult>
export async function workbenchGitOperation(gui: GuiClient, action: "stage", input: { paths?: string[]; all?: boolean }, directory?: string): Promise<WorkbenchOperationResult>
export async function workbenchGitOperation(gui: GuiClient, action: "unstage" | "discard", input: { paths: string[] }, directory?: string): Promise<WorkbenchOperationResult>
export async function workbenchGitOperation(gui: GuiClient, action: "commit", input: { message: string; body?: string; paths?: string[] }, directory?: string): Promise<WorkbenchOperationResult>
export async function workbenchGitOperation(gui: GuiClient, action: "fetch" | "pull" | "push" | "publish", input?: undefined, directory?: string): Promise<WorkbenchOperationResult>
export async function workbenchGitOperation(gui: GuiClient, action: string, input?: unknown, directory?: string): Promise<WorkbenchOperationResult> {
  return pluginApi<WorkbenchOperationResult>(gui, `/experimental/opencodex/workbench/git/${action}`, {
    method: "POST",
    body: input === undefined ? undefined : JSON.stringify(input),
  }, directory)
}

export async function workbenchGitStashes(gui: GuiClient, directory?: string): Promise<WorkbenchDataResult<WorkbenchGitStash[]>> {
  return pluginApi<WorkbenchDataResult<WorkbenchGitStash[]>>(gui, "/experimental/opencodex/workbench/git/stashes", {}, directory)
}

export async function workbenchGitStashCreate(gui: GuiClient, input: { message?: string }, directory?: string): Promise<WorkbenchOperationResult> {
  return pluginApi<WorkbenchOperationResult>(gui, "/experimental/opencodex/workbench/git/stash", {
    method: "POST",
    body: JSON.stringify(input),
  }, directory)
}

export async function workbenchGitStashOperation(gui: GuiClient, action: "apply" | "pop" | "drop", input: { ref: string }, directory?: string): Promise<WorkbenchOperationResult> {
  return pluginApi<WorkbenchOperationResult>(gui, `/experimental/opencodex/workbench/git/stash/${action}`, {
    method: "POST",
    body: JSON.stringify(input),
  }, directory)
}

export async function workbenchGithubData<T = unknown>(gui: GuiClient, action: "auth" | "repo" | "issues" | "pulls", directory?: string): Promise<WorkbenchDataResult<T>> {
  return pluginApi<WorkbenchDataResult<T>>(gui, `/experimental/opencodex/workbench/github/${action}`, {}, directory)
}

export async function workbenchGithubPost<T = unknown>(
  gui: GuiClient,
  action: "pull" | "checks" | "checkout-pull" | "create-pull",
  input: unknown,
  directory?: string,
): Promise<WorkbenchDataResult<T> | WorkbenchOperationResult> {
  return pluginApi<WorkbenchDataResult<T> | WorkbenchOperationResult>(gui, `/experimental/opencodex/workbench/github/${action}`, {
    method: "POST",
    body: JSON.stringify(input),
  }, directory)
}

export async function listPlugins(gui: GuiClient): Promise<GuiPlugin[]> {
  return pluginApi<GuiPlugin[]>(gui, "/experimental/opencodex/plugin")
}

export async function installPlugin(gui: GuiClient, input: { spec: string; global?: boolean; force?: boolean }): Promise<GuiPluginInstallResult> {
  return pluginApi<GuiPluginInstallResult>(gui, "/experimental/opencodex/plugin/install", {
    method: "POST",
    body: JSON.stringify(input),
  })
}

export async function togglePlugin(gui: GuiClient, input: { id: string; enabled: boolean }): Promise<GuiPlugin> {
  return pluginApi<GuiPlugin>(gui, "/experimental/opencodex/plugin/toggle", {
    method: "PATCH",
    body: JSON.stringify(input),
  })
}

async function pluginApi<T>(gui: GuiClient, pathname: string, init: RequestInit = {}, directory?: string): Promise<T> {
  const url = new URL(pathname, gui.url)
  if (directory || gui.directory) url.searchParams.set("directory", directory || gui.directory)
  const headers = {
    ...(init.body === undefined ? {} : { "content-type": "application/json" }),
    ...(authHeaders(gui) ?? {}),
    ...(init.headers ?? {}),
  }
  const response = await fetch(url, {
    ...init,
    headers,
    body: init.body,
  })
  const text = await response.text()
  const data = parsePluginResponse(text)
  if (!response.ok) {
    if (typeof data === "string") throw new Error(data || response.statusText)
    throw new Error(pluginErrorMessage(data, response))
  }
  return data as T
}

function parsePluginResponse(text: string): { message?: string; error?: string } | string | undefined {
  if (!text) return undefined
  try {
    const data = JSON.parse(text) as unknown
    if (typeof data === "object" && data !== null) return data as { message?: string; error?: string }
    return text
  } catch {
    return text
  }
}

function pluginErrorMessage(data: { message?: string; error?: string } | undefined, response: Response) {
  return data?.message ?? data?.error ?? (response.statusText || `Plugin request failed with ${response.status}`)
}
