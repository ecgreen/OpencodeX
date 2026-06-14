import type { Provider, Session } from "@opencode-ai/sdk/v2/client"
import type { MessageBundle } from "./store"
import { toolDisplayTitle, toolError, toolMetadata, toolOutput, toolStateInput } from "./tool-display"

export type GuiTranscriptOptions = {
  thinking: boolean
  toolDetails: boolean
  assistantMetadata: boolean
}

export function formatSessionTranscript(input: {
  session: Session
  messages: MessageBundle[]
  providers: Provider[]
  options?: Partial<GuiTranscriptOptions>
}) {
  const options = {
    thinking: input.options?.thinking ?? true,
    toolDetails: input.options?.toolDetails ?? true,
    assistantMetadata: input.options?.assistantMetadata ?? true,
  }
  return [
    `# ${input.session.title}`,
    "",
    `**Session ID:** ${input.session.id}`,
    `**Created:** ${new Date(input.session.time.created).toLocaleString()}`,
    `**Updated:** ${new Date(input.session.time.updated).toLocaleString()}`,
    "",
    "---",
    "",
    ...input.messages.flatMap((message) => [formatMessage(message, input.providers, options), "---", ""]),
  ].join("\n")
}

function formatMessage(message: MessageBundle, providers: Provider[], options: GuiTranscriptOptions) {
  const header = message.info.role === "user" ? "## User" : assistantHeader(message.info, providers, options.assistantMetadata)
  const body = message.parts
    .flatMap((part) => {
      if (part.type === "text") return part.synthetic || part.ignored ? [] : [part.text]
      if (part.type === "reasoning") return options.thinking ? [`_Thinking:_\n\n${part.text}`] : []
      if (part.type === "file") return [`[File: ${part.filename}]`]
      if (part.type === "tool") {
        const input = toolStateInput(part.state)
        const output = toolOutput(part.state)
        const metadata = toolMetadata(part.state) ?? {}
        const error = toolError(part.state)
        return [
          [
            `**Tool:** ${toolDisplayTitle(part.tool, input, metadata)}`,
            ...(options.toolDetails && Object.keys(input).length > 0 ? [`**Input:**\n\`\`\`json\n${JSON.stringify(input, null, 2)}\n\`\`\``] : []),
            ...(options.toolDetails && output ? [`**Output:**\n\`\`\`\n${output}\n\`\`\``] : []),
            ...(options.toolDetails && error ? [`**Error:**\n\`\`\`\n${error}\n\`\`\``] : []),
          ].join("\n\n"),
        ]
      }
      return []
    })
    .join("\n\n")
    .trim()
  return [header, "", body || "_No visible content._", ""].join("\n")
}

function assistantHeader(message: MessageBundle["info"], providers: Provider[], includeMetadata: boolean) {
  if (message.role !== "assistant" || !includeMetadata) return "## Assistant"
  return `## Assistant (${assistantModelLabel(message, providers)})`
}

function assistantModelLabel(message: MessageBundle["info"], providers: Provider[]) {
  if (message.role !== "assistant") return ""
  return providers.find((provider) => provider.id === message.providerID)?.models[message.modelID]?.name ?? message.modelID
}
