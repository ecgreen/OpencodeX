import os from "node:os"
import path from "node:path"

export function coordinatorEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
  home = os.homedir(),
  platform = process.platform,
) {
  if (platform === "win32") return { ...environment }
  const system = platform === "darwin" ? ["/opt/homebrew/bin", "/usr/local/bin"] : ["/usr/local/bin"]
  const entries = [
    path.posix.join(home, ".bun", "bin"),
    path.posix.join(home, ".local", "bin"),
    ...system,
    ...(environment.PATH ?? "").split(path.posix.delimiter).filter(Boolean),
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ]
  return {
    ...environment,
    PATH: [...new Set(entries)].join(path.posix.delimiter),
  }
}
