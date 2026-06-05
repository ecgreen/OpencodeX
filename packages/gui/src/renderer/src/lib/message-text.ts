const VISIBLE_CHANNELS = new Set(["commentary", "final"])
const HIDDEN_CHANNELS = new Set(["analysis"])

type JsonRecord = Record<string, unknown>

export function displayMessageText(text: string) {
  const clean = stripInternalReminders(text)
  const parsed = parseCompleteJson(clean.trim())
  if (parsed === undefined) return clean

  const extracted = extractVisibleText(parsed)
  return extracted?.trim() ? stripInternalReminders(extracted) : clean
}

function stripInternalReminders(text: string) {
  return text.replace(/(?:^|\n)<system-reminder>[\s\S]*?<\/system-reminder>\s*/g, (match) => match.startsWith("\n") ? "\n" : "")
}

function parseCompleteJson(text: string): unknown | undefined {
  if (!text) return
  if (!text.startsWith("{") && !text.startsWith("[") && !text.startsWith('"')) return
  try {
    return JSON.parse(text)
  } catch {
    return
  }
}

function extractVisibleText(value: unknown): string | undefined {
  if (typeof value === "string") return value
  if (Array.isArray(value)) return joinText(value.map(extractVisibleText))
  if (!isRecord(value)) return

  const channel = typeof value.channel === "string" ? value.channel : undefined
  if (channel) {
    if (HIDDEN_CHANNELS.has(channel)) return
    if (VISIBLE_CHANNELS.has(channel)) return extractVisibleText(value.content)
  }

  const channelText = joinText([
    extractVisibleText(value.commentary),
    extractVisibleText(value.final),
    extractVisibleText(value.final_answer),
  ])
  if (channelText) return channelText

  if (Array.isArray(value.output)) return extractOpenAIOutput(value.output)
  if (Array.isArray(value.choices)) return extractChoices(value.choices)

  if (isRecord(value.message)) {
    const role = typeof value.message.role === "string" ? value.message.role : undefined
    if (!role || role === "assistant") return extractVisibleText(value.message)
  }

  const type = typeof value.type === "string" ? value.type : undefined
  if ((type === "text" || type === "output_text") && typeof value.text === "string") return value.text
  if ((type === "message" || type === "assistant") && value.content !== undefined) return extractVisibleText(value.content)
  if (typeof value.role === "string" && value.content !== undefined) return extractVisibleText(value.content)

  return
}

function extractOpenAIOutput(output: unknown[]) {
  return joinText(
    output.map((item) => {
      if (!isRecord(item)) return extractVisibleText(item)
      if (Array.isArray(item.content)) return extractVisibleText(item.content)
      return extractVisibleText(item)
    }),
  )
}

function extractChoices(choices: unknown[]) {
  return joinText(
    choices.map((choice) => {
      if (!isRecord(choice)) return extractVisibleText(choice)
      return extractVisibleText(choice.message) ?? extractVisibleText(choice.delta)
    }),
  )
}

function joinText(values: Array<string | undefined>) {
  const visible = values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))
  if (visible.length === 0) return
  return visible.join("\n\n")
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
