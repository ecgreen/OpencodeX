#!/usr/bin/env bun

import path from "node:path"

const root = path.resolve(import.meta.dirname, "..")
const directory = process.env.OPENCODEX_DEV_DIRECTORY ?? process.cwd()
const child = Bun.spawn({
  cmd: ["bun", "run", "--conditions=browser", path.join(root, "packages", "opencode", "src", "index.ts"), ...process.argv.slice(2)],
  cwd: directory,
  env: {
    ...process.env,
    OPENCODE_CLI_NAME: "opencodex",
    PWD: directory,
  },
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
})

process.exit(await child.exited)
