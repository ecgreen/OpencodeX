import path from "node:path"
import { stat } from "node:fs/promises"
import { execFile } from "node:child_process"
import { CLAUDE_MISSING_MESSAGE, type ClaudeCodeStatus, type TerminalLaunchProfile } from "../shared/terminal.js"

type ClaudeProfile = Extract<TerminalLaunchProfile, { kind: "claude-code" }>

/**
 * Only flags verified against the CLI belong here. The session display name is
 * deliberately not forwarded - it lives on the OpencodeX record, and passing
 * renderer-controlled text as argv would hand it to the CLI's flag parser.
 */
export function claudeArguments(profile: ClaudeProfile) {
  if (profile.mode === "resume") return ["--resume", profile.resumeID]
  return ["--session-id", profile.resumeID]
}

export async function resolveClaudeExecutable(input?: {
  path?: string
  home?: string
  platform?: NodeJS.Platform
}) {
  const platform = input?.platform ?? process.platform
  // Windows resolves only claude.exe: node-pty cannot spawn .cmd shims, and the
  // extensionless npm shim would false-positively probe as executable there.
  const executableNames = platform === "win32" ? ["claude.exe"] : ["claude"]
  const fromPath = (input?.path ?? process.env.PATH ?? "")
    .split(platform === "win32" ? ";" : ":")
    .filter(Boolean)
    .flatMap((directory) => executableNames.map((name) => path.join(directory, name)))
  const home = input?.home
  const native = home
    ? platform === "win32"
      ? [path.join(home, ".local", "bin", "claude.exe")]
      : [path.join(home, ".local", "bin", "claude"), "/usr/local/bin/claude", "/opt/homebrew/bin/claude"]
    : []
  for (const candidate of new Set([...fromPath, ...native])) {
    if (await isExecutableFile(candidate, platform)) return candidate
  }
  return undefined
}

async function isExecutableFile(candidate: string, platform: NodeJS.Platform) {
  const info = await stat(candidate).catch(() => undefined)
  if (!info?.isFile()) return false
  return platform === "win32" || (info.mode & 0o111) !== 0
}

export async function probeClaudeCode(home: string): Promise<ClaudeCodeStatus> {
  const executable = await resolveClaudeExecutable({ home })
  if (!executable) {
    return { available: false, message: CLAUDE_MISSING_MESSAGE }
  }
  return await new Promise<ClaudeCodeStatus>((resolve) => {
    execFile(executable, ["--version"], { windowsHide: true, timeout: 5_000 }, (error, stdout, stderr) => {
      if (error) {
        console.error("claude --version probe failed", error)
        resolve({ available: false, executable, message: "Claude Code was found but did not respond. Check the installation, then try again." })
        return
      }
      resolve({ available: true, executable, version: (stdout || stderr).trim() || undefined })
    })
  })
}
