export type WorkbenchDiagnosticsRunResult = {
  code: number
  stdout: Buffer
  stderr: Buffer
}

export type WorkbenchDiagnostic = {
  path?: string
  line?: number
  column?: number
  endLine?: number
  endColumn?: number
  severity: "error" | "warning" | "info"
  message: string
}

export type WorkbenchDefinitionLocation = {
  path: string
  root?: string
  readOnly?: true
  line: number
  column: number
  endLine: number
  endColumn: number
}

export type WorkbenchHoverResult = {
  supported: boolean
  message?: string
  contents: Array<{
    kind: "code" | "markdown" | "plaintext"
    value: string
    language?: string
  }>
  definitions: WorkbenchDefinitionLocation[]
  range?: {
    line: number
    column: number
    endLine: number
    endColumn: number
  }
}

export type WorkbenchRelativeImport = {
  specifier: string
  line: number
  column: number
  endLine: number
  endColumn: number
}

export type WorkbenchCompletionResult = {
  supported: boolean
  message?: string
  items: Array<{
    label: string
    detail?: string
    documentation?: string
    insertText?: string
    filterText?: string
    sortText?: string
    kind?: number
    insertTextFormat?: number
  }>
}

export type WorkbenchDiagnosticsResult = {
  ok: boolean
  command?: string
  message?: string
  output?: string
  diagnostics: WorkbenchDiagnostic[]
}

type PackageJson = {
  scripts?: Record<string, unknown>
}

export async function workbenchDiagnostics(
  cwd: string,
  run: (cmd: string[], cwd: string) => Promise<WorkbenchDiagnosticsRunResult>,
  fileExists: (path: string) => Promise<boolean> = (file) => Bun.file(file).exists(),
): Promise<WorkbenchDiagnosticsResult> {
  const command = await detectWorkbenchDiagnosticsCommand(cwd, fileExists)
  if (!command) {
    return {
      ok: true,
      message: "No typecheck/check script found for this project yet.",
      diagnostics: [],
    }
  }
  const result = await run(command, cwd)
  const output = diagnosticsOutput(result)
  return {
    ok: result.code === 0,
    command: command.join(" "),
    message: result.code === 0 ? "Project checks passed." : "Project checks found issues.",
    output: output.slice(0, 80_000),
    diagnostics: parseWorkbenchDiagnostics(output),
  }
}

export async function detectWorkbenchDiagnosticsCommand(
  cwd: string,
  fileExists: (path: string) => Promise<boolean> = (file) => Bun.file(file).exists(),
) {
  const packageJson = await readPackageJson(cwd)
  const scripts = packageJson?.scripts ?? {}
  const script = ["typecheck", "check", "lint"].find((name) => typeof scripts[name] === "string")
  if (script) return [...(await packageManagerCommand(cwd, fileExists)), "run", script]
  if (await fileExists(`${cwd}/tsconfig.json`) && await fileExists(`${cwd}/node_modules/.bin/tsc`)) return [`${cwd}/node_modules/.bin/tsc`, "--noEmit", "--pretty", "false"]
  if (await fileExists(`${cwd}/tsconfig.json`) && await fileExists(`${cwd}/node_modules/.bin/tsc.cmd`)) return [`${cwd}/node_modules/.bin/tsc.cmd`, "--noEmit", "--pretty", "false"]
  return undefined
}

export function parseWorkbenchDiagnostics(output: string): WorkbenchDiagnostic[] {
  return output.split(/\r?\n/).flatMap((line) => parseWorkbenchDiagnosticLine(line)).slice(0, 200)
}

export function fileWorkbenchDiagnostics(file: string, diagnostics: readonly LSPDiagnostic[]): WorkbenchDiagnostic[] {
  return diagnostics.slice(0, 200).map((diagnostic) => ({
    path: file.replaceAll("\\", "/"),
    line: diagnostic.range.start.line + 1,
    column: diagnostic.range.start.character + 1,
    endLine: diagnostic.range.end.line + 1,
    endColumn: diagnostic.range.end.character + 1,
    severity: diagnostic.severity === 2 ? "warning" : diagnostic.severity === 1 ? "error" : "info",
    message: diagnostic.message,
  }))
}

export function workbenchDefinitionLocations(
  definitions: readonly unknown[],
  instance: InstanceContext,
): WorkbenchDefinitionLocation[] {
  const seen = new Set<string>()
  return definitions.flatMap((definition) => {
    const target = definitionTarget(definition)
    if (!target) return []
    const file = definitionFile(target.uri)
    const targetFile = file ? workbenchFileTarget(file, instance) : undefined
    if (!targetFile) return []
    const location = {
      ...targetFile,
      line: target.range.start.line + 1,
      column: target.range.start.character + 1,
      endLine: target.range.end.line + 1,
      endColumn: target.range.end.character + 1,
    }
    const key = `${location.root ?? ""}:${location.path}:${location.line}:${location.column}:${location.endLine}:${location.endColumn}`
    if (seen.has(key)) return []
    seen.add(key)
    return [location]
  })
}

export function workbenchHoverResult(
  results: readonly unknown[],
  definitions: WorkbenchDefinitionLocation[] = [],
): WorkbenchHoverResult {
  const hovers = results.filter((result): result is Record<string, unknown> => Boolean(result) && typeof result === "object" && !Array.isArray(result))
  const contents = hovers
    .flatMap((hover) => hoverContents(hover.contents))
    .filter((content, index, all) => all.findIndex((item) => item.kind === content.kind && item.language === content.language && item.value === content.value) === index)
    .slice(0, 12)
  const range = hovers.map((hover) => locationRange(hover.range)).find((item) => item !== undefined)
  return {
    supported: true,
    contents,
    definitions: definitions.slice(0, 10),
    ...(range ? {
      range: {
        line: range.start.line + 1,
        column: range.start.character + 1,
        endLine: range.end.line + 1,
        endColumn: range.end.character + 1,
      },
    } : {}),
  }
}

export function workbenchCompletionResult(items: readonly CompletionItem[]): WorkbenchCompletionResult {
  return {
    supported: true,
    items: items.flatMap((item) => {
      if (!item.label) return []
      const documentation = typeof item.documentation === "string"
        ? item.documentation
        : item.documentation?.value
      const textEdit = item.textEdit && "newText" in item.textEdit ? item.textEdit.newText : undefined
      return [{
        label: item.label.slice(0, 500),
        ...(item.detail ? { detail: item.detail.slice(0, 2_000) } : {}),
        ...(documentation ? { documentation: documentation.slice(0, 8_000) } : {}),
        ...(textEdit || item.insertText ? { insertText: (textEdit || item.insertText)!.slice(0, 8_000) } : {}),
        ...(item.filterText ? { filterText: item.filterText.slice(0, 500) } : {}),
        ...(item.sortText ? { sortText: item.sortText.slice(0, 500) } : {}),
        ...(item.kind === undefined ? {} : { kind: item.kind }),
        ...(item.insertTextFormat === undefined ? {} : { insertTextFormat: item.insertTextFormat }),
      }]
    }).slice(0, 200),
  }
}

export function workbenchRelativeImport(content: string, line: number, column: number): WorkbenchRelativeImport | undefined {
  const source = content.split(/\r\n|\r|\n/)[line - 1]
  if (source === undefined) return
  const offset = column - 1
  return Array.from(source.matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)(["'`])([^"'`]+)\1/g))
    .flatMap((match) => {
      const specifier = match[2]
      if (!specifier || match.index === undefined) return []
      const start = match.index + match[0].lastIndexOf(specifier)
      if (offset < start - 1 || offset > start + specifier.length) return []
      return [{
        specifier,
        line,
        column: start + 1,
        endLine: line,
        endColumn: start + specifier.length + 1,
      }]
    })[0]
}

function hoverContents(input: unknown): WorkbenchHoverResult["contents"] {
  return (Array.isArray(input) ? input : [input]).flatMap((content): WorkbenchHoverResult["contents"] => {
    if (typeof content === "string" && content.trim()) {
      return [{ kind: "markdown" as const, value: content.slice(0, 16_000) }]
    }
    if (!content || typeof content !== "object" || Array.isArray(content)) return []
    const value = content as Record<string, unknown>
    if (typeof value.value !== "string" || !value.value.trim()) return []
    if (typeof value.language === "string") {
      return [{ kind: "code" as const, language: value.language, value: value.value.slice(0, 16_000) }]
    }
    if (value.kind === "markdown" || value.kind === "plaintext") {
      return [{ kind: value.kind, value: value.value.slice(0, 16_000) }]
    }
    return []
  })
}

function definitionTarget(input: unknown) {
  if (!input || typeof input !== "object") return
  const value = input as Record<string, unknown>
  const uri = typeof value.targetUri === "string" ? value.targetUri : typeof value.uri === "string" ? value.uri : undefined
  const range = locationRange(value.targetSelectionRange ?? value.range)
  if (!uri || !range) return
  return { uri, range }
}

function locationRange(input: unknown) {
  if (!input || typeof input !== "object") return
  const value = input as Record<string, unknown>
  const start = locationPosition(value.start)
  const end = locationPosition(value.end)
  if (!start || !end) return
  return { start, end }
}

function locationPosition(input: unknown) {
  if (!input || typeof input !== "object") return
  const value = input as Record<string, unknown>
  if (!Number.isInteger(value.line) || !Number.isInteger(value.character)) return
  if ((value.line as number) < 0 || (value.character as number) < 0) return
  return { line: value.line as number, character: value.character as number }
}

function definitionFile(uri: string) {
  if (!uri.startsWith("file://")) return
  try {
    return Filesystem.normalizePath(fileURLToPath(uri))
  } catch {
    return undefined
  }
}

function parseWorkbenchDiagnosticLine(line: string): WorkbenchDiagnostic[] {
  const tsStyle = /^(.+?)\((\d+),(\d+)\):\s*(error|warning|info)\s+((?:[A-Z]+\d+:\s*)?.+)$/.exec(line.trim())
  if (tsStyle) {
    return [diagnosticFromMatch({
      path: tsStyle[1],
      line: tsStyle[2],
      column: tsStyle[3],
      severity: tsStyle[4],
      message: tsStyle[5],
    })]
  }
  const colonStyle = /^(.+?):(\d+):(\d+):\s*(?:(error|warning|info)\s*)?(.+)$/.exec(line.trim())
  if (!colonStyle) return []
  if (!/[./\\]/.test(colonStyle[1] ?? "")) return []
  return [diagnosticFromMatch({
    path: colonStyle[1],
    line: colonStyle[2],
    column: colonStyle[3],
    severity: colonStyle[4],
    message: colonStyle[5],
  })]
}

function diagnosticFromMatch(input: {
  path?: string
  line?: string
  column?: string
  severity?: string
  message?: string
}): WorkbenchDiagnostic {
  const line = Number(input.line)
  const column = Number(input.column)
  const path = input.path?.replaceAll("\\", "/")
  return {
    ...(path ? { path } : {}),
    ...(Number.isSafeInteger(line) && line > 0 ? { line } : {}),
    ...(Number.isSafeInteger(column) && column > 0 ? { column } : {}),
    severity: input.severity === "warning" ? "warning" : input.severity === "info" ? "info" : "error",
    message: input.message?.trim() || "Diagnostic",
  }
}

async function packageManagerCommand(cwd: string, fileExists: (path: string) => Promise<boolean>) {
  if (await fileExists(`${cwd}/bun.lock`) || await fileExists(`${cwd}/bun.lockb`)) return ["bun"]
  if (await fileExists(`${cwd}/pnpm-lock.yaml`)) return ["pnpm"]
  if (await fileExists(`${cwd}/yarn.lock`)) return ["yarn"]
  return ["npm"]
}

async function readPackageJson(cwd: string): Promise<PackageJson | undefined> {
  const file = Bun.file(`${cwd}/package.json`)
  if (!(await file.exists())) return undefined
  try {
    const value = await file.json()
    if (typeof value !== "object" || value === null) return undefined
    return value as PackageJson
  } catch {
    return undefined
  }
}

function diagnosticsOutput(result: WorkbenchDiagnosticsRunResult) {
  return [result.stdout.toString("utf8").trim(), result.stderr.toString("utf8").trim()]
    .filter(Boolean)
    .join("\n")
}
import type { InstanceContext } from "@/project/instance-context"
import { workbenchFileTarget } from "./workbench-path"
import { Filesystem } from "@/util/filesystem"
import { fileURLToPath } from "url"
import type { CompletionItem, Diagnostic as LSPDiagnostic } from "vscode-languageserver-types"
