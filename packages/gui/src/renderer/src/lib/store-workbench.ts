import type { FileContent, FileNode } from "@opencode-ai/sdk/v2/client"
import type { GuiClient } from "./client"
import { authHeaders } from "./store-auth"
import {
  type DiffFile,
  type GuiPlugin,
  type GuiPluginInstallResult,
  type WorkbenchDataResult,
  type WorkbenchDiagnosticsResult,
  type WorkbenchGitBranches,
  type WorkbenchGitHistoryCommit,
  type WorkbenchGitStash,
  type WorkbenchGitStatus,
  type WorkbenchOperationResult,
} from "./store"

export async function findFiles(gui: GuiClient, input: { query: string; directory?: string; limit?: number }): Promise<FileNode[]> {
  return gui.client.find.files({
    directory: input.directory || gui.directory || undefined,
    query: input.query,
    dirs: "true",
    limit: input.limit ?? 20,
  }, { headers: authHeaders(gui), throwOnError: true }).then((x) => (x.data ?? []).map((file) => typeof file === "string" ? {
    name: file.split(/[\\/]/).at(-1) ?? file,
    path: file,
    absolute: file,
    type: "file",
    ignored: false,
  } : file))
}

export async function listWorkbenchFiles(gui: GuiClient, path: string, directory?: string): Promise<FileNode[]> {
  return gui.client.file.list({
    directory: directory || gui.directory || undefined,
    path,
  }, { headers: authHeaders(gui), throwOnError: true }).then((x) => x.data ?? [])
}

export async function readWorkbenchFile(gui: GuiClient, path: string, directory?: string): Promise<FileContent | undefined> {
  const file = await gui.client.file.read({
    directory: directory || gui.directory || undefined,
    path,
  }, { headers: authHeaders(gui), throwOnError: true }).then((x) => x.data)
  if (!file) return
  if (file.encoding === "base64") return { ...file, type: "binary" }
  if (file.type !== "text") return file
  const exact = await pluginApi<WorkbenchOperationResult>(
    gui,
    `/experimental/opencodex/workbench/file/read?path=${encodeURIComponent(path)}`,
    {},
    directory,
  )
  return exact.ok && exact.content !== undefined ? { ...file, content: exact.content } : file
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

export async function workbenchGitStatus(gui: GuiClient, directory?: string): Promise<WorkbenchGitStatus> {
  return pluginApi<WorkbenchGitStatus>(gui, "/experimental/opencodex/workbench/git/status", {}, directory)
}

export async function workbenchGitBranches(gui: GuiClient, directory?: string): Promise<WorkbenchGitBranches> {
  return pluginApi<WorkbenchGitBranches>(gui, "/experimental/opencodex/workbench/git/branches", {}, directory)
}

export async function workbenchGitDiff(gui: GuiClient, directory?: string): Promise<WorkbenchDataResult<DiffFile[]>> {
  return pluginApi<WorkbenchDataResult<DiffFile[]>>(gui, "/experimental/opencodex/workbench/git/diff", {}, directory)
}

export async function workbenchGitHistory(gui: GuiClient, directory?: string): Promise<WorkbenchDataResult<WorkbenchGitHistoryCommit[]>> {
  return pluginApi<WorkbenchDataResult<WorkbenchGitHistoryCommit[]>>(gui, "/experimental/opencodex/workbench/git/history", {}, directory)
}

export async function workbenchDiagnostics(gui: GuiClient, directory?: string): Promise<WorkbenchDiagnosticsResult> {
  return pluginApi<WorkbenchDiagnosticsResult>(gui, "/experimental/opencodex/workbench/diagnostics", {}, directory)
}

export async function workbenchGitOperation(gui: GuiClient, action: "checkout" | "create-branch", input: { branch: string }, directory?: string): Promise<WorkbenchOperationResult>
export async function workbenchGitOperation(gui: GuiClient, action: "stage" | "unstage" | "discard", input: { paths: string[] }, directory?: string): Promise<WorkbenchOperationResult>
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
