#!/usr/bin/env bun

import path from "node:path"

const root = path.resolve(import.meta.dirname, "..")
const lock = (await Bun.file(path.join(root, "upstream/lock.json")).json()) as {
  ref: string
  sha: string
  latestObserved: { ref: string; sha: string }
  backports: { sha: string }[]
}
const target =
  Bun.argv.find((argument) => !argument.startsWith("--") && argument !== Bun.argv[0] && argument !== Bun.argv[1]) ??
  lock.latestObserved.ref
const format = Bun.argv.includes("--json") ? "json" : Bun.argv.includes("--markdown") ? "markdown" : "text"
const resolved = run("git", "rev-parse", "--verify", `${target}^{commit}`)
const files = run("git", "diff", "--name-only", lock.sha, resolved).split("\n").filter(Boolean)
const categories = {
  backend: [] as string[],
  storage: [] as string[],
  sdkApi: [] as string[],
  providers: [] as string[],
  dependencies: [] as string[],
  upstreamFrontends: [] as string[],
  pruned: [] as string[],
  shared: [] as string[],
}

for (const file of files) {
  if (/^(packages\/opencode\/src\/(server|session|tool|project|config)|packages\/core\/)/.test(file))
    categories.backend.push(file)
  if (/database|migration|storage|sqlite/i.test(file)) categories.storage.push(file)
  if (/^(packages\/sdk\/js|packages\/opencode\/src\/server\/routes)/.test(file)) categories.sdkApi.push(file)
  if (/provider|models\.dev|auth/i.test(file)) categories.providers.push(file)
  if (/package\.json$|bun\.lock$|^patches\//.test(file)) categories.dependencies.push(file)
  if (/^(packages\/(app|desktop)|packages\/opencode\/src\/cli\/cmd\/tui)/.test(file))
    categories.upstreamFrontends.push(file)
  if (
    /^(packages\/(cli|enterprise|function|slack)|docs\/website|containers|identity|extensions|infra|nix|sdks\/vscode)/.test(
      file,
    )
  )
    categories.pruned.push(file)
  if (
    /^(packages\/opencode\/src\/(server|session|provider|mcp|plugin)|packages\/sdk\/js)|^(package\.json|bun\.lock)$/.test(
      file,
    )
  )
    categories.shared.push(file)
}

const report = {
  base: { ref: lock.ref, sha: lock.sha },
  target: { ref: target, sha: resolved },
  commits: Number(run("git", "rev-list", "--count", `${lock.sha}..${resolved}`)),
  changedFiles: files.length,
  categories,
  satisfiedBackports: lock.backports.filter(
    (backport) => run("git", "merge-base", "--is-ancestor", backport.sha, resolved, true) === "0",
  ),
}

if (format === "json") console.log(JSON.stringify(report, null, 2))
if (format === "text") {
  console.log(
    `${report.base.ref} (${report.base.sha.slice(0, 12)}) -> ${report.target.ref} (${report.target.sha.slice(0, 12)})`,
  )
  console.log(`${report.commits} commits, ${report.changedFiles} changed files`)
  for (const [name, matches] of Object.entries(categories)) console.log(`${name}: ${matches.length}`)
}
if (format === "markdown") {
  console.log(
    `# Upstream sync report\n\n- Base: \`${report.base.ref}\` (\`${report.base.sha}\`)\n- Target: \`${report.target.ref}\` (\`${report.target.sha}\`)\n- Commits: ${report.commits}\n- Changed files: ${report.changedFiles}\n`,
  )
  for (const [name, matches] of Object.entries(categories)) {
    console.log(`## ${name}\n\n${matches.length ? matches.map((file) => `- \`${file}\``).join("\n") : "None"}\n`)
  }
}

function run(command: string, ...args: (string | boolean)[]) {
  const quiet = args.at(-1) === true
  const result = Bun.spawnSync(
    [command, ...args.filter((argument): argument is string => typeof argument === "string")],
    { cwd: root },
  )
  if (quiet) return String(result.exitCode)
  if (result.exitCode !== 0) throw new Error(result.stderr.toString().trim() || `${command} failed`)
  return result.stdout.toString().trim()
}
