#!/usr/bin/env bun
/*
 * Runs the CLI subprocess suites, isolated from the rest of the unit job, and
 * reports how long each case actually took as GitHub annotations.
 *
 * The timings are not decoration. Every Windows failure in these suites has
 * been a budget expiring, which censors the one number needed to tell "this
 * runner is slower than the budget" from "this child is wedged forever" - both
 * render as a duration a hair over the limit. Job logs need auth to fetch;
 * annotations do not, so the durations stay readable from the API on a pass as
 * well as a failure, and a regression shows up as a number rather than a shrug.
 *
 * See cli-subprocess-suites.ts for why these run apart from test:ci.
 */
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { cliSubprocessSuites as suites } from "./cli-subprocess-suites"

const dir = path.resolve(import.meta.dir, "..")
process.chdir(dir)

// bun's --reporter-outfile will not create the directory for you.
const reports = path.join(dir, ".artifacts/cli-subprocess")
await mkdir(reports, { recursive: true })

const bundle = (await Bun.$`bun run ${path.join(import.meta.dir, "test-cli-bundle.ts")}`.text()).trim()
console.log(`[cli-subprocess] bundle ${bundle}`)

/*
 * Durations come from the junit report, not the console. bun only prints the
 * per-case "(pass) name [1234ms]" lines when something fails, and a clean run
 * with its timings intact is exactly what needs inspecting here.
 */
const testcase = /<testcase\b([^>]*?)(\/>|>)/g
const attr = (tag: string, name: string) => tag.match(new RegExp(`${name}="([^"]*)"`))?.[1]

type Row = { status: string; name: string; ms: number }
const rows: Row[] = []
const broken: string[] = []

for (const suite of suites) {
  const started = Date.now()
  const report = path.join(reports, `${suite.replaceAll(/[^a-zA-Z0-9.-]/g, "-")}.xml`)
  const proc = Bun.spawn(
    // prettier-ignore
    ["bun", "test", suite, "--timeout", "300000", "--max-concurrency", "1", "--reporter", "junit", "--reporter-outfile", report],
    { cwd: dir, env: { ...process.env, OPENCODE_TEST_CLI_BUNDLE: bundle }, stdout: "pipe", stderr: "pipe" },
  )
  const [, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  const elapsed = Date.now() - started

  const xml = (await Bun.file(report).exists()) ? await Bun.file(report).text() : ""
  for (const [, tag, close] of xml.matchAll(testcase)) {
    const name = attr(tag, "name")
    if (!name) continue
    // Self-closing means no <failure>/<skipped> child, i.e. it passed.
    rows.push({ status: close === "/>" ? "pass" : "FAIL", name, ms: Number(attr(tag, "time") ?? 0) * 1000 })
  }
  console.log(`[cli-subprocess] ${code === 0 ? "PASS" : "FAIL"} ${suite} ${(elapsed / 1000).toFixed(1)}s`)
  if (code !== 0) {
    broken.push(`${suite} (exit ${code})`)
    console.log(err.split("\n").slice(-40).join("\n"))
  }
}

rows.sort((left, right) => right.ms - left.ms)
const table = rows.map((row) => `${row.status.padEnd(4)} ${(row.ms / 1000).toFixed(1)}s  ${row.name}`).join("\n")
console.log(`\n${table}`)

// ::notice:: rather than ::error:: on a clean run so a green run does not read
// as a failure, but both land in the annotations API.
const level = broken.length ? "error" : "notice"
const title = broken.length ? `cli subprocess FAILED: ${broken.join(", ")}` : "cli subprocess timings (all passed)"
console.log(`::${level} title=${title}::${table.replaceAll("\n", "%0A")}`)

if (broken.length) process.exitCode = 1
