export function editorCommand(value: string) {
  const parts = [...value.matchAll(/"([^"]*)"|'([^']*)'|[^\s]+/g)].map((match) => match[1] ?? match[2] ?? match[0])
  const command = parts[0]?.trim()
  if (!command) return
  return { command, args: parts.slice(1) }
}
