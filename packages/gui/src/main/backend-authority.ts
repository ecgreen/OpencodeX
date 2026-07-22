import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const FILE = path.join(
  process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state"),
  "opencode",
  "backend-authority.json",
)

export async function rememberBackendAuthority(database: string, file = FILE) {
  if (database === ":memory:") return
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(
    tmp,
    JSON.stringify({ version: 1, database, updatedAt: Date.now() }, null, 2),
    { mode: 0o600 },
  )
  await fs.rename(tmp, file)
}
