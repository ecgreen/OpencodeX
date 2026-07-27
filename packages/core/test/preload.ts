import { afterAll } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { setTimeout as sleep } from "node:timers/promises"

const dir = path.join(os.tmpdir(), `opencodex-core-test-${process.pid}`)
await fs.mkdir(dir, { recursive: true })

process.env["XDG_DATA_HOME"] = path.join(dir, "share")
process.env["XDG_CACHE_HOME"] = path.join(dir, "cache")
process.env["XDG_CONFIG_HOME"] = path.join(dir, "config")
process.env["XDG_STATE_HOME"] = path.join(dir, "state")
process.env["OPENCODE_TEST_HOME"] = path.join(dir, "home")
process.env["OPENCODE_MODELS_PATH"] = path.join(dir, "models.json")
await fs.writeFile(process.env["OPENCODE_MODELS_PATH"], "{}")

afterAll(async () => {
  async function cleanup(left: number): Promise<void> {
    Bun.gc(true)
    await sleep(100)
    return fs.rm(dir, { recursive: true, force: true }).catch((error) => {
      if (!isBusy(error) || left <= 1) throw error
      return cleanup(left - 1)
    })
  }

  await cleanup(30)
})

function isBusy(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EBUSY"
}
