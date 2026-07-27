import path from "node:path"

type FindingKind = "rawControls" | "legacyControls" | "rawColors" | "themeOverrides" | "important" | "duplicateGlobalSelectors" | "modulePrimitiveOverrides" | "oversized" | "rawTypeSize" | "rawTypeWeight" | "rawSpacing" | "rawRadius" | "rawShadow"
type Finding = { kind: FindingKind; file: string; line: number; text: string }

const packageRoot = path.resolve(import.meta.dirname, "..")
const rendererRoot = path.join(packageRoot, "src", "renderer", "src")
const staged = process.argv.includes("--staged")
const report = process.argv.includes("--report")
const strict = process.argv.includes("--strict")
const rawControl = /<(button|input|textarea|select)\b/
// `variant` is a legacy control-style prop. It stays legal as a domain word
// (a model or agent variant), so only flag it on an actual control.
const legacyControl = /<(?:Button|IconButton|Select|TextField|TextInput|TextArea|Textarea|Input|SearchField)\b[^>]*\bvariant=|<Button\b[^>]*\bclass=["'][^"']*\b(?:primary|secondary|danger)\b/
const rawColor = /(?:#[0-9a-f]{3,8}\b|\brgba?\s*\(\s*[\d.]|\bhsla?\s*\(\s*[\d.])/i
const themeOverride = /--theme-[a-z0-9-]+\s*:/i
const important = /!important\b/i
// Foundation tokens own these values. A literal outside the theme sheets is debt.
const rawTypeSize = /font-size\s*:\s*[^;}]*?\d*\.?\d+(?:px|rem|em)\b/i
const rawTypeWeight = /font-weight\s*:\s*\d{3}\b/i
const rawSpacing = /\b(?:padding|margin|gap|row-gap|column-gap)(?:-(?:top|right|bottom|left|inline|block))?\s*:\s*[^;}]*?\d*\.?\d+px\b/i
const rawRadius = /border-radius\s*:\s*[^;}]*?\d*\.?\d+px\b/i
const rawShadow = /box-shadow\s*:\s*[^;}]*?\d*\.?\d+px\b/i

const normalized = (value: string) => value.replaceAll("\\", "/")
const relative = (value: string) => normalized(path.relative(packageRoot, value))
const lineNumber = (text: string, index: number) => text.slice(0, index).split(/\r?\n/).length

function allowed(kind: FindingKind, file: string, line: string) {
  if (kind === "rawControls") {
    if (file.includes("/components/ui/")) return true
    // The component lab is a development surface, not shipped product chrome.
    if (file.includes("/components/lab/")) return true
    if (/<input\b[^>]*type=["']file["']/i.test(line)) return true
  }
  if (kind === "rawColors") {
    if (file.includes("/styles/themes/")) return true
    if (file.includes("design-system-lab.module.css")) return true
    if (/(code-editor|session-side-terminal|gui-plugins)/i.test(file)) return true
  }
  if (kind === "themeOverrides" && file.includes("/styles/themes/")) return true
  if (kind === "rawTypeSize" || kind === "rawTypeWeight" || kind === "rawSpacing" || kind === "rawRadius" || kind === "rawShadow") {
    // The theme sheets define the tokens these rules protect.
    if (file.includes("/styles/themes/")) return true
    // The component lab is a development surface, not shipped product chrome.
    if (file.includes("/components/lab/") || file.includes("design-system-lab")) return true
    // Editor, terminal, and plugin theming pass values to library APIs.
    if (/(code-editor|session-side-terminal|gui-plugins|terminal-presentation)/i.test(file)) return true
  }
  // A spread-only ring (`0 0 0 Npx`) is focus or selection geometry, not
  // elevation, so it is not something an elevation token should own.
  if (kind === "rawShadow" && /box-shadow\s*:\s*(?:inset\s+)?0\s+0\s+0\s+[\d.]+px/i.test(line)) return true
  if (kind === "important") {
    if (file.endsWith("/styles/design-base.css")) return true
    if (file.includes("/styles/bridges/")) return true
  }
  return false
}

function inspect(file: string, text: string) {
  const findings: Finding[] = []
  const sourceFile = relative(file)
  const patterns: Array<[FindingKind, RegExp]> = [
    ["rawControls", rawControl],
    ["legacyControls", legacyControl],
    ["rawColors", rawColor],
    ["themeOverrides", themeOverride],
    ["important", important],
    ["rawTypeSize", rawTypeSize],
    ["rawTypeWeight", rawTypeWeight],
    ["rawSpacing", rawSpacing],
    ["rawRadius", rawRadius],
    ["rawShadow", rawShadow],
  ]
  for (const [kind, pattern] of patterns) {
    for (const [index, line] of text.split(/\r?\n/).entries()) {
      if (!pattern.test(line) || allowed(kind, `/${sourceFile}`, line)) continue
      findings.push({ kind, file: sourceFile, line: index + 1, text: line.trim() })
    }
  }
  if (sourceFile.endsWith(".module.css")) {
    for (const match of text.matchAll(/(?:\.ui-|\[data-ui=|\[data-component=["'](?:button|select|menu))/g)) {
      findings.push({ kind: "modulePrimitiveOverrides", file: sourceFile, line: lineNumber(text, match.index), text: match[0] })
    }
  }
  const lines = text.split(/\r?\n/).length
  if (lines >= 500 || (lines >= 400 && !sourceFile.includes("design-system-lab.module.css"))) {
    findings.push({ kind: "oversized", file: sourceFile, line: lines, text: `${lines} lines` })
  }
  return findings
}

function stagedAddedLines() {
  const diff = Bun.spawnSync(["git", "diff", "--cached", "--unified=0", "--", "packages/gui"])
  if (diff.exitCode !== 0) throw new Error(diff.stderr.toString())
  const files = new Map<string, string[]>()
  let current = ""
  for (const line of diff.stdout.toString().split(/\r?\n/)) {
    if (line.startsWith("+++ b/")) {
      current = normalized(line.slice(6))
      continue
    }
    if (!current || !line.startsWith("+") || line.startsWith("+++")) continue
    const value = files.get(current) ?? []
    value.push(line.slice(1))
    files.set(current, value)
  }
  return files
}

function summarize(findings: Finding[]) {
  return findings.reduce<Record<FindingKind, number>>(
    (counts, finding) => ({ ...counts, [finding.kind]: counts[finding.kind] + 1 }),
    { rawControls: 0, legacyControls: 0, rawColors: 0, themeOverrides: 0, important: 0, duplicateGlobalSelectors: 0, modulePrimitiveOverrides: 0, oversized: 0, rawTypeSize: 0, rawTypeWeight: 0, rawSpacing: 0, rawRadius: 0, rawShadow: 0 },
  )
}

async function duplicateSelectors(files: string[]) {
  const owners = new Map<string, { file: string; line: number }>()
  const findings: Finding[] = []
  for (const file of files.filter((item) => item.endsWith(".css") && !item.endsWith(".module.css"))) {
    const lines = (await Bun.file(file).text()).split(/\r?\n/)
    const context: Array<{ kind: "at" | "rule"; value: string }> = []
    for (const [index, line] of lines.entries()) {
      const value = line.trim()
      const atRule = value.match(/^@([\w-]+)\s*([^{}]*)\{\s*$/)
      if (atRule) {
        context.push({ kind: "at", value: `@${atRule[1]} ${atRule[2].trim()}` })
        continue
      }
      const selector = value.match(/^([^@{}][^{}]+)\s*\{\s*$/)?.[1]?.trim().replace(/\s+/g, " ")
      if (selector) {
        const key = `${context.filter((item) => item.kind === "at").map((item) => item.value).join("|")}::${selector}`
        const owner = owners.get(key)
        // The theme sheets split :root by concern: foundation owns type, space,
        // shape, and motion; dark and light own the palette.
        const sharedTokenRoot = selector === ":root" && normalized(file).includes("/styles/themes/")
        if (!owner) owners.set(key, { file: relative(file), line: index + 1 })
        else if (!sharedTokenRoot) findings.push({ kind: "duplicateGlobalSelectors", file: relative(file), line: index + 1, text: `${selector} also owned by ${owner.file}:${owner.line}` })
        context.push({ kind: "rule", value: selector })
        continue
      }
      if (value !== "}") continue
      context.pop()
    }
  }
  return findings
}

async function fullScan() {
  const files = await Array.fromAsync(new Bun.Glob("**/*.{ts,tsx,css}").scan({ cwd: rendererRoot, absolute: true }))
  const findings = [
    ...(await Promise.all(files.map(async (file) => inspect(file, await Bun.file(file).text())))).flat(),
    ...(await duplicateSelectors(files)),
  ]
  const counts = summarize(findings)
  if (report) {
    console.log(JSON.stringify(counts, null, 2))
    return
  }
  const baseline = await Bun.file(path.join(import.meta.dirname, "design-system-baseline.json")).json() as Record<FindingKind, number>
  const regressions = Object.entries(counts).filter(([kind, count]) => count > (strict ? 0 : baseline[kind as FindingKind]))
  if (regressions.length === 0) {
    console.log(`Design-system check passed: ${findings.length} tracked legacy findings, no regression.`)
    return
  }
  const detail = findings.filter((finding) => regressions.some(([kind]) => finding.kind === kind)).slice(0, 30)
  throw new Error(`Design-system regressions:\n${regressions.map(([kind, count]) => `${kind}: ${count} (allowed ${strict ? 0 : baseline[kind as FindingKind]})`).join("\n")}\n${detail.map((finding) => `${finding.file}:${finding.line} ${finding.kind} ${finding.text}`).join("\n")}`)
}

if (staged) {
  const findings = [...stagedAddedLines()].flatMap(([file, lines]) => inspect(path.join(path.dirname(packageRoot), "..", file), lines.join("\n")))
  if (findings.length > 0) throw new Error(`New staged GUI design-system debt:\n${findings.map((finding) => `${finding.file}:${finding.line} ${finding.kind} ${finding.text}`).join("\n")}`)
  console.log("Staged GUI design-system check passed.")
} else {
  await fullScan()
}
