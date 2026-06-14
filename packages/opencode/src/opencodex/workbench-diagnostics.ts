export type WorkbenchDiagnosticsRunResult = {
  code: number
  stdout: Buffer
  stderr: Buffer
}

export type WorkbenchDiagnostic = {
  path?: string
  line?: number
  column?: number
  severity: "error" | "warning" | "info"
  message: string
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
