import { createMemo, createResource, type Accessor } from "solid-js"
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
  const mentionReferenceQuery = createMemo(() => {
    const query = mentionQuery()
    if (query === undefined) return
    return referenceSearch({ query, config: input.props.config })
  })
  const mentionFileQuery = createMemo(() => {
    const query = mentionQuery()
    if (query === undefined || referenceSearch({ query, config: input.props.config })) return
    return query
  })
  const [mentionFiles] = createResource(mentionFileQuery, async (query) => input.props.findFiles ? input.props.findFiles({ query }) : [])
  const [mentionReferenceFiles] = createResource(mentionReferenceQuery, async (match) => {
    if (!input.props.findFiles) return []
    return (await input.props.findFiles({ query: match.query, directory: match.root })).map((file) => ({ alias: match.alias, root: match.root, file }))
  })
  const mentionOptions = createMemo(() => {
    const query = mentionQuery()
    if (query === undefined) return []
    return buildPromptMentionOptions({
      query,
      agents: input.props.agents,
      config: input.props.config,
      files: mentionFiles() ?? [],
      referenceFiles: mentionReferenceFiles() ?? [],
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
