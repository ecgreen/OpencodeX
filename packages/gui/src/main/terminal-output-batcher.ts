export const TERMINAL_OUTPUT_BATCH_MS = 12
export const TERMINAL_OUTPUT_BATCH_BYTES = 256 * 1024

type Timer = ReturnType<typeof setTimeout>

export function createTerminalOutputBatcher(input: {
  emit: (data: string) => void
  delay?: number
  maxBytes?: number
  schedule?: (callback: () => void, delay: number) => Timer
  cancel?: (timer: Timer) => void
}) {
  const chunks: string[] = []
  const schedule = input.schedule ?? setTimeout
  const cancel = input.cancel ?? clearTimeout
  const maxBytes = Math.max(4, Math.trunc(input.maxBytes ?? TERMINAL_OUTPUT_BATCH_BYTES))
  let bytes = 0
  let timer: Timer | undefined
  let closed = false

  function push(data: string) {
    if (closed || !data) return
    let remaining = data
    while (remaining) {
      const end = utf8PrefixEnd(remaining, maxBytes - bytes)
      if (end === 0) {
        flush()
        continue
      }
      const chunk = remaining.slice(0, end)
      chunks.push(chunk)
      bytes += Buffer.byteLength(chunk)
      remaining = remaining.slice(end)
      if (bytes >= maxBytes) flush()
    }
    if (chunks.length > 0 && timer === undefined) timer = schedule(flush, input.delay ?? TERMINAL_OUTPUT_BATCH_MS)
  }

  function flush() {
    if (timer !== undefined) cancel(timer)
    timer = undefined
    if (closed || chunks.length === 0) return
    const data = chunks.join("")
    chunks.length = 0
    bytes = 0
    input.emit(data)
  }

  function close(flushPending: boolean) {
    if (closed) return
    if (flushPending) flush()
    if (timer !== undefined) cancel(timer)
    timer = undefined
    chunks.length = 0
    bytes = 0
    closed = true
  }

  return { push, flush, close }
}

function utf8PrefixEnd(value: string, maxBytes: number) {
  let bytes = 0
  let end = 0
  for (const character of value) {
    const size = Buffer.byteLength(character)
    if (bytes + size > maxBytes) break
    bytes += size
    end += character.length
  }
  return end
}
