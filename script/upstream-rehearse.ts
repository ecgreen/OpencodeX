#!/usr/bin/env bun

import path from "node:path"

const root = path.resolve(import.meta.dirname, "..")
const lock = (await Bun.file(path.join(root, "upstream/lock.json")).json()) as {
  latestObserved: { ref: string }
  historyMode: string
}
const target = Bun.argv[2] ?? lock.latestObserved.ref
const result = Bun.spawnSync(
  [
    "git",
    "merge-tree",
    "--write-tree",
    ...(lock.historyMode === "snapshot-import-without-common-ancestor" ? ["--allow-unrelated-histories"] : []),
    "HEAD",
    target,
  ],
  { cwd: root },
)
const output = `${result.stdout.toString()}\n${result.stderr.toString()}`.trim()
if (result.exitCode !== 0 && result.exitCode !== 1) throw new Error(output || "git merge-tree failed")
const lines = output.split("\n")
console.log(`rehearsal HEAD -> ${target}`)
console.log(`tree: ${lines[0] ?? "unavailable"}`)
console.log(`auto-merged paths: ${lines.filter((line) => line.startsWith("Auto-merging ")).length}`)
console.log(`conflict records: ${lines.filter((line) => line.includes("CONFLICT")).length}`)
console.log("No worktree or branch was changed.")
