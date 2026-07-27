export function alive(owner: string, runID: string) {
  const match = /^local:(\d+):([^:]+):/.exec(owner)
  if (!match) return true
  const pid = Number(match[1])
  if (pid === process.pid) return match[2] === runID
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return typeof error === "object" && error !== null && "code" in error && error.code === "EPERM"
  }
}

export * as SessionExecutionOwner from "./execution-owner"
