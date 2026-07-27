import path from "node:path"
import { mkdir, readFile, writeFile } from "node:fs/promises"

export async function readInstallationID(userData: string): Promise<string> {
  const file = path.join(userData, "installation-id")
  const current = await readFile(file, "utf8").catch(() => undefined)
  if (current && isUUID(current.trim())) return current.trim().toLowerCase()
  await mkdir(userData, { recursive: true })
  const id = crypto.randomUUID()
  try {
    // "wx" so two racing first runs cannot each keep a different in-memory id:
    // the loser re-reads whatever the winner persisted.
    await writeFile(file, `${id}\n`, { encoding: "utf8", mode: 0o600, flag: current === undefined ? "wx" : "w" })
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") return readInstallationID(userData)
    throw error
  }
  return id
}

export function isUUID(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}
