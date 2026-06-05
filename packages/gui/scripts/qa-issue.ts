import fs from "node:fs"
import path from "node:path"

const args = parseArgs(process.argv.slice(2))
const severity = args.severity ?? "P1"
const card = args.card ?? "Unassigned"
const summary = args.summary ?? "GUI parity issue"
const now = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-")
const slug = `${severity}-${card}-${summary}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")
const outDir = path.resolve(import.meta.dirname, "..", ".artifacts", "gui", "issues")
const output = path.join(outDir, `${now}-${slug}.md`)

fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(
  output,
  `# GUI QA Issue\n\n## Summary\n\n${summary}\n\n## Card\n\n${card}\n\n## Severity\n\n${severity}\n\n## Environment\n\n- OS: ${process.platform}\n- GUI command/build: ${args.command ?? ""}\n- TUI command: ${args.tui ?? ""}\n- Project directory: ${args.directory ?? process.cwd()}\n- Backend URL if known: ${args.url ?? ""}\n\n## TUI Expected Behavior\n\n${args.expected ?? ""}\n\n## GUI Actual Behavior\n\n${args.actual ?? ""}\n\n## Steps To Reproduce\n\n1. ${args.steps ?? ""}\n\n## Evidence\n\n${args.evidence ?? ""}\n\n## Data Safety\n\n- Did this affect the wrong session/project/view/swarm? ${args.safety ?? "Unknown"}\n- Did this approve/deny/cancel/delete anything unexpectedly? Unknown\n- Is any data unreadable from TUI after GUI action? Unknown\n\n## Suggested Owner\n\n${args.owner ?? "Senior Engineer"}\n`,
)

console.log(output)

function parseArgs(input: string[]) {
  const result: Record<string, string> = {}
  for (let i = 0; i < input.length; i += 1) {
    const key = input[i]
    if (!key.startsWith("--")) continue
    result[key.slice(2)] = input[i + 1] ?? ""
    i += 1
  }
  return result
}
