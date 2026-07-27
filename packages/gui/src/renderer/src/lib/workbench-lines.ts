type WorkbenchLineMatch = {
  original: number
  current: number
}

export function workbenchLineStates(input: { current: string; original: string }) {
  const changed = workbenchChangedLineNumbers(input)
  const current = splitWorkbenchLines(input.current)
  return current.map((text, index) => ({
    number: index + 1,
    text,
    modified: changed.has(index + 1),
  }))
}

export function workbenchChangedLineNumbers(input: { current: string; original: string }) {
  if (input.current === input.original) return new Set<number>()
  const current = splitWorkbenchLines(input.current)
  const original = splitWorkbenchLines(input.original)
  const matches = new Set(workbenchLineMatches(original, current).map((match) => match.current))
  const changed = new Set(current.flatMap((_, index) => matches.has(index) ? [] : [index + 1]))
  if (changed.size > 0 || current.length === 0) return changed
  const anchor = current.findIndex((line, index) => line !== original[index])
  return new Set([Math.min(Math.max(anchor + 1, 1), current.length)])
}

export function highlightWorkbenchCode(input: { text: string; path: string }) {
  return splitWorkbenchLines(input.text).map((line) => highlightWorkbenchLine(line, input.path)).join("\n")
}

export function workbenchLineDiffRows(originalText: string, currentText: string) {
  const original = splitWorkbenchLines(originalText)
  const current = splitWorkbenchLines(currentText)
  const matches = workbenchLineMatches(original, current)
  const rows: string[] = []
  let originalIndex = 0
  let currentIndex = 0
  for (const match of matches) {
    while (originalIndex < match.original) {
      rows.push(`-${original[originalIndex] ?? ""}`)
      originalIndex++
    }
    while (currentIndex < match.current) {
      rows.push(`+${current[currentIndex] ?? ""}`)
      currentIndex++
    }
    rows.push(` ${current[match.current] ?? ""}`)
    originalIndex = match.original + 1
    currentIndex = match.current + 1
  }
  while (originalIndex < original.length) {
    rows.push(`-${original[originalIndex] ?? ""}`)
    originalIndex++
  }
  while (currentIndex < current.length) {
    rows.push(`+${current[currentIndex] ?? ""}`)
    currentIndex++
  }
  return rows
}

function splitWorkbenchLines(text: string) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n")
  return lines.length ? lines : [""]
}

function workbenchLineMatches(original: readonly string[], current: readonly string[]) {
  const prefix: WorkbenchLineMatch[] = []
  let prefixIndex = 0
  while (prefixIndex < original.length && prefixIndex < current.length && original[prefixIndex] === current[prefixIndex]) {
    prefix.push({ original: prefixIndex, current: prefixIndex })
    prefixIndex++
  }

  const suffix: WorkbenchLineMatch[] = []
  let originalEnd = original.length - 1
  let currentEnd = current.length - 1
  while (originalEnd >= prefixIndex && currentEnd >= prefixIndex && original[originalEnd] === current[currentEnd]) {
    suffix.push({ original: originalEnd, current: currentEnd })
    originalEnd--
    currentEnd--
  }

  const originalMiddle = original.slice(prefixIndex, originalEnd + 1)
  const currentMiddle = current.slice(prefixIndex, currentEnd + 1)
  const middle = originalMiddle.length * currentMiddle.length > 300_000
    ? []
    : workbenchMiddleLineMatches(originalMiddle, currentMiddle).map((match) => ({
        original: match.original + prefixIndex,
        current: match.current + prefixIndex,
      }))
  return [...prefix, ...middle, ...suffix.reverse()]
}

function workbenchMiddleLineMatches(original: readonly string[], current: readonly string[]) {
  const width = current.length + 1
  const scores = new Uint32Array((original.length + 1) * width)
  for (let originalIndex = 1; originalIndex <= original.length; originalIndex++) {
    for (let currentIndex = 1; currentIndex <= current.length; currentIndex++) {
      const index = originalIndex * width + currentIndex
      scores[index] = original[originalIndex - 1] === current[currentIndex - 1]
        ? scores[(originalIndex - 1) * width + currentIndex - 1] + 1
        : Math.max(scores[(originalIndex - 1) * width + currentIndex], scores[originalIndex * width + currentIndex - 1])
    }
  }

  const matches: WorkbenchLineMatch[] = []
  let originalIndex = original.length
  let currentIndex = current.length
  while (originalIndex > 0 && currentIndex > 0) {
    if (original[originalIndex - 1] === current[currentIndex - 1]) {
      matches.push({ original: originalIndex - 1, current: currentIndex - 1 })
      originalIndex--
      currentIndex--
      continue
    }
    if (scores[(originalIndex - 1) * width + currentIndex] >= scores[originalIndex * width + currentIndex - 1]) {
      originalIndex--
      continue
    }
    currentIndex--
  }
  return matches.reverse()
}

function highlightWorkbenchLine(line: string, file: string) {
  const commentStart = lineCommentStart(line, file)
  if (commentStart >= 0) {
    return `${highlightWorkbenchTokens(line.slice(0, commentStart))}<span class="syntax-comment">${escapeHtml(line.slice(commentStart))}</span>`
  }
  return highlightWorkbenchTokens(line)
}

function highlightWorkbenchTokens(line: string) {
  const tokens = line.match(/(["'`])(?:\\.|(?!\1).)*\1|\b[A-Za-z_$][\w$]*\b|\b\d+(?:\.\d+)?\b|[{}[\]().,:;<>+\-*/%=!&|?]+|\s+|./g) ?? []
  return tokens.map((token, index) => {
    if (/^\s+$/.test(token)) return token
    if (/^(["'`])/.test(token)) return `<span class="syntax-string">${escapeHtml(token)}</span>`
    if (/^\d/.test(token)) return `<span class="syntax-constant">${escapeHtml(token)}</span>`
    if (/^[{}[\]().,:;<>+\-*/%=!&|?]+$/.test(token)) return `<span class="syntax-punctuation">${escapeHtml(token)}</span>`
    if (WORKBENCH_KEYWORDS.has(token)) return `<span class="syntax-keyword">${escapeHtml(token)}</span>`
    if (WORKBENCH_PRIMITIVES.has(token)) return `<span class="syntax-primitive">${escapeHtml(token)}</span>`
    if (/^[A-Z]/.test(token)) return `<span class="syntax-type">${escapeHtml(token)}</span>`
    if ((tokens[index + 1] ?? "").startsWith("(")) return `<span class="syntax-property">${escapeHtml(token)}</span>`
    return escapeHtml(token)
  }).join("")
}

function lineCommentStart(line: string, file: string) {
  const trimmed = file.toLowerCase()
  const hash = line.indexOf("#")
  const slash = line.indexOf("//")
  if ([".py", ".sh", ".bash", ".zsh", ".ps1", ".yml", ".yaml", ".toml"].some((extension) => trimmed.endsWith(extension))) return hash
  if (slash >= 0) return slash
  return hash === 0 ? hash : -1
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

const WORKBENCH_KEYWORDS = new Set([
  "abstract", "and", "as", "async", "await", "break", "case", "catch", "class", "const", "continue", "def",
  "default", "do", "elif", "else", "enum", "export", "extends", "finally", "for", "from", "func", "function",
  "go", "if", "impl", "import", "in", "interface", "let", "match", "module", "namespace", "new", "not", "or",
  "package", "private", "protected", "public", "return", "self", "static", "struct", "switch", "then", "throw",
  "trait", "try", "type", "var", "while", "with", "yield",
])
const WORKBENCH_PRIMITIVES = new Set(["false", "null", "None", "nil", "true", "undefined"])
