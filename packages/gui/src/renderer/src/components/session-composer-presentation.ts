import type { FileNode } from "@opencode-ai/sdk/v2/client"
import { createEffect, createMemo, createSignal, onCleanup, type Accessor } from "solid-js"
import { createDebouncedSearch } from "../lib/async-search"
import { buildPromptMentionOptions, referenceSearch } from "../lib/prompt-autocomplete"
import { formatTokenCount, isAssistantMessage, textPart } from "../lib/session-composer-helpers"
import type { SessionPageProps } from "./session-page-types"

export function createSessionComposerPresentation(input: { props: SessionPageProps; draftPrompt: Accessor<string>; slashMenuOpen: Accessor<boolean>; blocked: Accessor<boolean> }) {
  const slashQuery = createMemo(() => {
    const draft = input.draftPrompt()
    if (!draft.startsWith("/") || draft.includes(" ") || draft.includes("\n")) return
    return draft.slice(1).toLowerCase()
  })
  const visibleSlashCommands = createMemo(() => {
    const query = slashQuery()
    if (query === undefined) return []
    return input.props.slashCommands.filter((command) =>
      [command.name, command.title, command.detail, command.disabled, ...(command.aliases ?? [])]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query),
    )
  })
  const slashMenuVisible = createMemo(() => input.slashMenuOpen() && !input.blocked() && slashQuery() !== undefined)
  const mentionQuery = createMemo(() => {
    const draft = input.draftPrompt()
    const match = /(?:^|\s)@([^\s@]*)$/.exec(draft)
    return match?.[1]
  })
  const mentionFileSearch = createMemo(() => {
    const query = mentionQuery()
    if (query === undefined) return
    const reference = referenceSearch({ query, config: input.props.config })
    const directory = reference?.root ?? input.props.sidePanelDirectory ?? input.props.session?.directory ?? input.props.gui?.directory ?? ""
    const context = `${input.props.gui?.url ?? "no-client"}\n${directory}`
    return reference ? { kind: "reference" as const, ...reference, context } : { kind: "file" as const, query, directory, context }
  })
  const [mentionFiles, setMentionFiles] = createSignal<FileNode[]>([])
  const [mentionReferenceFiles, setMentionReferenceFiles] = createSignal<Array<{ alias: string; root: string; file: FileNode }>>([])
  const fileSearch = createDebouncedSearch<NonNullable<ReturnType<typeof mentionFileSearch>>, FileNode[]>({
    key: (query) => query.kind === "file"
      ? `file\n${query.context}\n${query.query}`
      : `reference\n${query.context}\n${query.root}\n${query.query}`,
    load: (query, signal) => input.props.findFiles?.({
      query: query.query,
      ...(query.kind === "reference" ? { directory: query.root } : query.directory ? { directory: query.directory } : {}),
      signal,
    }) ?? Promise.resolve([]),
    success: (files, query) => {
      if (query.kind === "file") {
        setMentionFiles(files)
        setMentionReferenceFiles([])
        return
      }
      setMentionFiles([])
      setMentionReferenceFiles(files.map((file) => ({ alias: query.alias, root: query.root, file })))
    },
    error: () => {
      setMentionFiles([])
      setMentionReferenceFiles([])
    },
  })
  createEffect(() => {
    const query = mentionFileSearch()
    if (query && input.props.findFiles) {
      fileSearch.search(query)
      return
    }
    fileSearch.clear()
    setMentionFiles([])
    setMentionReferenceFiles([])
  })
  onCleanup(fileSearch.dispose)
  const mentionOptions = createMemo(() => {
    const query = mentionQuery()
    if (query === undefined) return []
    return buildPromptMentionOptions({
      query,
      agents: input.props.agents,
      config: input.props.config,
      files: mentionFiles(),
      referenceFiles: mentionReferenceFiles(),
      mcpResources: input.props.mcpResources,
      limit: 10,
    })
  })
  const mentionMenuVisible = createMemo(() => mentionOptions().length > 0 && !input.blocked())
  const userHistory = createMemo(() =>
    input.props.data.messages
      .filter((bundle) => bundle.info.role === "user")
      .map((bundle) => bundle.parts.map(textPart).join("").trim())
      .filter(Boolean),
  )
  const usageLabel = createMemo(() => {
    const last = input.props.data.messages.findLast((bundle) => isAssistantMessage(bundle.info) && bundle.info.tokens.output > 0)?.info
    if (!last || !isAssistantMessage(last)) return
    const tokens = last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
    if (tokens <= 0) return
    const limit = input.props.providers.find((provider) => provider.id === last.providerID)?.models[last.modelID]?.limit.context
    const pct = limit ? ` (${Math.round((tokens / limit) * 100)}%)` : ""
    return `${formatTokenCount(tokens)}${pct}`
  })
  return { slashQuery, visibleSlashCommands, slashMenuVisible, mentionQuery, mentionOptions, mentionMenuVisible, userHistory, usageLabel }
}
