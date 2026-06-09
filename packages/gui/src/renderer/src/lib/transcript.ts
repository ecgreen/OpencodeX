import type { Provider, Session } from "@opencode-ai/sdk/v2/client"
import type { MessageBundle } from "./store"
import { toolDisplayTitle, toolMetadata, toolOutput, toolStateInput } from "./tool-display"

export function formatSessionTranscript(input: {
  session: Session
  messages: MessageBundle[]
  providers: Provider[]
}) {
  return [
    `# ${input.session.title}`,
    "",
    `**Session ID:** ${input.session.id}`,
    `**Created:** ${new Date(input.session.time.created).toLocaleString()}`,
    `**Updated:** ${new Date(input.session.time.updated).toLocaleString()}`,
    "",
    "---",
    "",
    ...input.messages.flatMap((message) => [formatMessage(message, input.providers), "---", ""]),
  ].join("\n")
}

function formatMessage(message: MessageBundle, providers: Provider[]) {
  const header = message.info.role === "user" ? "## User" : `## Assistant (${assistantModelLabel(message.info, providers)})`
  const body = message.parts
    .flatMap((part) => {
      if (part.type === "text") return part.synthetic || part.ignored ? [] : [part.text]
      if (part.type === "reasoning") return [`> ${part.text.replace(/\n/g, "\n> ")}`]
      if (part.type === "file") return [`[File: ${part.filename}]`]
      if (part.type === "tool") {
        const input = toolStateInput(part.state)
        const output = toolOutput(part.state)
        const metadata = toolMetadata(part.state) ?? {}
        return [`**Tool:** ${toolDisplayTitle(part.tool, input, metadata)}${output ? `\n\n\`\`\`\n${output}\n\`\`\`` : ""}`]
      }
      return []
    })
    .join("\n\n")
    .trim()
  return [header, "", body || "_No visible content._", ""].join("\n")
}

function assistantModelLabel(message: MessageBundle["info"], providers: Provider[]) {
  if (message.role !== "assistant") return ""
  return providers.find((provider) => provider.id === message.providerID)?.models[message.modelID]?.name ?? message.modelID
}
