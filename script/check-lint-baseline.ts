// Oxlint's JSON report is several megabytes; reading it through a stdout pipe
// has truncated mid-string on large reports (unterminated-JSON failures in CI
// and locally). Buffering through a file sidesteps the pipe entirely.
const reportPath = `${import.meta.dir}/../.artifacts/oxlint-report.json`
await Bun.write(reportPath, "")
const process = Bun.spawn(["bunx", "oxlint", "--format", "json"], {
  cwd: import.meta.dir + "/..",
  stdout: Bun.file(reportPath),
  stderr: "pipe",
})
const [stderr, exitCode] = await Promise.all([new Response(process.stderr).text(), process.exited])
const stdout = await Bun.file(reportPath).text()

const result = JSON.parse(stdout)
if (!record(result) || !Array.isArray(result.diagnostics)) {
  throw new Error(`Oxlint returned an invalid report.\n${stderr}`)
}
const diagnostics = result.diagnostics.filter(record)
const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "error")
const warnings = diagnostics.filter((diagnostic) => diagnostic.severity === "warning")
const baseline = JSON.parse(await Bun.file(import.meta.dir + "/../.oxlint-baseline.json").text())
if (!record(baseline) || typeof baseline.warnings !== "number") throw new Error("Invalid .oxlint-baseline.json")

if (errors.length > 0 || exitCode !== 0) {
  errors.slice(0, 20).forEach((diagnostic) => console.error(format(diagnostic)))
  throw new Error(`Oxlint reported ${errors.length} correctness error(s).`)
}
if (warnings.length > baseline.warnings) {
  throw new Error(`Oxlint warnings increased from ${baseline.warnings} to ${warnings.length}.`)
}
console.log(`Oxlint: ${warnings.length} warning(s), baseline ${baseline.warnings}.`)

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function format(diagnostic: Record<string, unknown>) {
  return [diagnostic.filename, diagnostic.code, diagnostic.message]
    .filter((value) => typeof value === "string")
    .join(": ")
}
