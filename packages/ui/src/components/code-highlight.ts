export const CODE_HIGHLIGHT_MAX_BYTES = 128 * 1024
export const CODE_HIGHLIGHT_MAX_LINE_BYTES = 8 * 1024

export function utf8ByteLength(value: string) {
  let bytes = 0
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code < 0x80) {
      bytes++
      continue
    }
    if (code < 0x800) {
      bytes += 2
      continue
    }
    if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      value.charCodeAt(index + 1) >= 0xdc00 &&
      value.charCodeAt(index + 1) <= 0xdfff
    ) {
      bytes += 4
      index++
      continue
    }
    bytes += 3
  }
  return bytes
}

export function utf8PrefixLength(value: string, maxBytes: number, end = value.length) {
  const limit = Math.min(end, value.length)
  let bytes = 0
  for (let index = 0; index < limit; index++) {
    const code = value.charCodeAt(index)
    const size =
      code < 0x80
        ? 1
        : code < 0x800
          ? 2
          : code >= 0xd800 &&
              code <= 0xdbff &&
              index + 1 < limit &&
              value.charCodeAt(index + 1) >= 0xdc00 &&
              value.charCodeAt(index + 1) <= 0xdfff
            ? 4
            : 3
    if (bytes + size > maxBytes) return index
    bytes += size
    if (size === 4) index++
  }
  return limit
}

export function canHighlightCode(code: string) {
  let total = 0
  let line = 0
  for (let index = 0; index < code.length; index++) {
    const value = code.charCodeAt(index)
    const bytes =
      value < 0x80
        ? 1
        : value < 0x800
          ? 2
          : value >= 0xd800 &&
              value <= 0xdbff &&
              code.charCodeAt(index + 1) >= 0xdc00 &&
              code.charCodeAt(index + 1) <= 0xdfff
            ? 4
            : 3
    if (bytes === 4) index++
    total += bytes
    if (total > CODE_HIGHLIGHT_MAX_BYTES) return false
    if (value === 10 || value === 13) {
      line = 0
      continue
    }
    line += bytes
    if (line > CODE_HIGHLIGHT_MAX_LINE_BYTES) return false
  }
  return true
}

export function escapedCodeBlock(code: string) {
  return `<pre><code>${code
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")}</code></pre>`
}
