import type { Agent, Config, FileNode, McpResource } from "@opencode-ai/sdk/v2/client"
import type { PromptPart } from "./store"

export type PromptMentionOption = {
  label: string
  detail: string
  category: "Agents" | "References" | "Files" | "MCP Resources"
  replacement: string
  part: PromptPart
}

export function buildPromptMentionOptions(input: {
  query: string
  agents: Agent[]
  config?: Config
  files?: FileNode[]
  referenceFiles?: Array<{ alias: string; root: string; file: FileNode }>
  mcpResources?: Record<string, McpResource>
  limit?: number
}): PromptMentionOption[] {
  const needle = input.query.trim().toLowerCase()
  return [
    ...referenceAliasOptions(input.config),
    ...agentOptions(input.agents),
    ...fileOptions(input.files ?? []),
    ...referenceFileOptions(input.referenceFiles ?? []),
    ...resourceOptions(input.mcpResources ?? {}),
  ]
    .filter((option) => !needle || `${option.label} ${option.detail} ${option.category}`.toLowerCase().includes(needle))
    .slice(0, input.limit ?? 12)
}

export function referenceSearch(input: { query: string; config?: Config }) {
  const slash = input.query.indexOf("/")
  if (slash <= 0) return
  const alias = input.query.slice(0, slash)
  const reference = referenceEntries(input.config).find((item) => item.name === alias)
  if (!reference?.path) return
  return { alias, root: reference.path, query: input.query.slice(slash + 1) }
}

export function prunePromptPartsForInput(input: string, parts: PromptPart[]) {
  return parts.filter((part) => {
    const labels = partLabels(part)
    if (labels.length === 0) return true
    return labels.some((label) => input.includes(`@${label}`))
  })
}

export function restorePromptPartsFromEditedText(previous: PromptPart[], edited: string) {
  return prunePromptPartsForInput(edited, previous)
}

function agentOptions(agents: Agent[]): PromptMentionOption[] {
  return agents
    .filter((agent) => !agent.hidden && agent.mode !== "primary")
    .map((agent) => ({
      label: agent.name,
      detail: agent.description ?? "Agent",
      category: "Agents" as const,
      replacement: `@${agent.name}`,
      part: { type: "agent" as const, name: agent.name },
    }))
}

function referenceAliasOptions(config?: Config): PromptMentionOption[] {
  return referenceEntries(config).map((reference) => ({
    label: reference.name,
    detail: reference.detail,
    category: "References" as const,
    replacement: `@${reference.name}`,
    part: {
      type: "text" as const,
      text: [
        `Referenced configured reference @${reference.name}.`,
        reference.path ? `Reference root: ${reference.path}` : reference.detail,
        "For targeted context, inspect the reference path directly with Read, Glob, and Grep.",
      ].join("\n"),
      synthetic: true,
    },
  }))
}

function fileOptions(files: FileNode[]): PromptMentionOption[] {
  return files.map((file) => ({
    label: file.path,
    detail: file.type,
    category: "Files" as const,
    replacement: `@${file.path}`,
    part: filePart(file.path, file.absolute, file.type),
  }))
}

function referenceFileOptions(files: Array<{ alias: string; root: string; file: FileNode }>): PromptMentionOption[] {
  return files.map((item) => {
    const filename = `${item.alias}/${item.file.path}`
    return {
      label: filename,
      detail: item.root,
      category: "References" as const,
      replacement: `@${filename}`,
      part: filePart(filename, item.file.absolute, item.file.type),
    }
  })
}

function resourceOptions(resources: Record<string, McpResource>): PromptMentionOption[] {
  return Object.values(resources).map((resource) => ({
    label: resource.name,
    detail: `${resource.client} ${resource.uri}`,
    category: "MCP Resources" as const,
    replacement: `@${resource.name}`,
    part: {
      type: "file" as const,
      mime: resource.mimeType ?? "text/plain",
      filename: resource.name,
      url: resource.uri,
      source: {
        type: "resource" as const,
        clientName: resource.client,
        uri: resource.uri,
        text: { value: resource.name, start: 0, end: resource.name.length },
      },
    },
  }))
}

function filePart(filename: string, absolute: string, type: FileNode["type"]): PromptPart {
  return {
    type: "file",
    mime: type === "directory" ? "application/x-directory" : "text/plain",
    filename,
    url: fileURL(absolute),
    source: {
      type: "file",
      path: absolute,
      text: { value: filename, start: 0, end: filename.length },
    },
  }
}

function referenceEntries(config?: Config) {
  return Object.entries(config?.reference ?? {}).map(([name, entry]) => {
    const path = typeof entry === "object" && entry !== null && "path" in entry && typeof entry.path === "string"
      ? entry.path
      : typeof entry === "string"
        ? entry
        : undefined
    const detail = typeof entry === "string"
      ? entry
      : typeof entry === "object" && entry !== null && "repository" in entry && typeof entry.repository === "string"
        ? entry.repository
        : path ?? "configured reference"
    return { name, path, detail }
  })
}

function partLabels(part: PromptPart) {
  if (part.type === "agent") return [part.name]
  if (part.type === "file") return [part.filename, part.source?.type === "resource" ? part.source.uri : undefined].filter((item): item is string => Boolean(item))
  return []
}

function fileURL(value: string) {
  const normalized = value.replaceAll("\\", "/")
  if (/^[a-zA-Z]:\//.test(normalized)) return `file:///${encodeURI(normalized)}`
  if (normalized.startsWith("/")) return `file://${encodeURI(normalized)}`
  return `file://${encodeURI(normalized)}`
}
