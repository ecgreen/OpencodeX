import { mkdir, rm } from "node:fs/promises"
import path from "node:path"

const output = path.join(import.meta.dir, "../.artifacts/unit")
await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })

await run([
  "bun",
  "test",
  "--timeout",
  "30000",
  "--max-concurrency",
  "4",
  "--path-ignore-patterns",
  "test/cli/tui/**",
  "--path-ignore-patterns",
  "test/cli/cmd/tui/**",
  "--path-ignore-patterns",
  "test/cli/run/**",
  "--path-ignore-patterns",
  "test/plugin/openai-ws.test.ts",
  "--path-ignore-patterns",
  "test/server/httpapi-listen.test.ts",
  "--reporter",
  "junit",
  "--reporter-outfile",
  path.join(output, "junit.xml"),
])

await serial("test/plugin/openai-ws.test.ts", "openai-ws.xml")
await serial("test/server/httpapi-listen.test.ts", "httpapi-listen.xml")
await serial("test/cli/tui", "tui.xml")
await serialFiles("test/cli/cmd/tui", "tui-sync")
await serialFiles("test/cli/run", "run-ui")

async function serialFiles(directory: string, report: string) {
  const root = path.join(import.meta.dir, "..", directory)
  const files = [...new Bun.Glob("**/*.test.*").scanSync({ cwd: root })]
    .filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"))
    .toSorted()
  for (const file of files) {
    const target = path.join(directory, file).replaceAll("\\", "/")
    await serial(target, `${report}-${file.replace(/[^a-zA-Z0-9.-]/g, "-")}.xml`)
  }
}

function serial(target: string, report: string) {
  return run([
    "bun",
    "test",
    target,
    "--timeout",
    "30000",
    "--max-concurrency",
    "1",
    "--reporter",
    "junit",
    "--reporter-outfile",
    path.join(output, report),
  ])
}

async function run(command: string[]) {
  const child = Bun.spawn(command, {
    cwd: path.join(import.meta.dir, ".."),
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  })
  const code = await child.exited
  if (code !== 0) throw new Error(`Test command failed with exit code ${code}: ${command.join(" ")}`)
}
