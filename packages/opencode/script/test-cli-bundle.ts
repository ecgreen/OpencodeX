#!/usr/bin/env bun
/*
 * Bundles the CLI once so subprocess tests don't re-transpile it per spawn.
 *
 * test/lib/cli-process spawns the real binary. Spawned from source that is
 * `bun run --conditions=browser src/index.ts`, which walks and transpiles the
 * whole CLI graph every time - about 1.5s on a warm dev box and several times
 * that on a cold CI runner, where every module read is a separate stat plus a
 * virus scan. Paid once per child, across dozens of children, it stops being
 * startup cost and starts being the thing the test budgets are measuring.
 *
 * Build once, spawn `bun <bundle>` instead, and the child reads a single file.
 *
 * Prints the bundle entry path on stdout so callers can capture it. Set
 * OPENCODE_TEST_CLI_BUNDLE to that path and the harness picks it up; leave it
 * unset and the harness falls back to spawning from source, which keeps a bare
 * `bun test` working with no build step.
 */
import { createSolidTransformPlugin } from "@opentui/solid/bun-plugin"
import path from "node:path"

const dir = path.resolve(import.meta.dir, "..")
const outdir = path.join(dir, ".artifacts/test-cli")

process.chdir(dir)

const started = Date.now()
const result = await Bun.build({
  // Mirrors script/build.ts: the harness previously passed --conditions=browser
  // on the command line, so baking the same condition in keeps module
  // resolution (notably #db / #pty) identical to the from-source spawn.
  conditions: ["browser"],
  tsconfig: "./tsconfig.json",
  plugins: [createSolidTransformPlugin()],
  external: ["node-gyp"],
  format: "esm",
  target: "bun",
  // Unminified and unsplit: this is only ever read by the test harness, and a
  // readable bundle keeps stack traces in failure output worth reading.
  minify: false,
  sourcemap: "none",
  splitting: false,
  outdir,
  entrypoints: ["./src/index.ts"],
  define: {
    OPENCODE_VERSION: "'0.0.0-test'",
    OPENCODE_CHANNEL: "'dev'",
    OPENCODE_LIBC: "''",
  },
})

if (!result.success) {
  for (const log of result.logs) console.error(log.message)
  throw new AggregateError(result.logs, "Failed to bundle the CLI for subprocess tests")
}

const entry = path.join(outdir, "index.js")
if (!(await Bun.file(entry).exists())) throw new Error(`Bundle succeeded but ${entry} is missing`)

console.error(`[build-test-cli] bundled in ${Date.now() - started}ms -> ${entry}`)
console.log(entry)
