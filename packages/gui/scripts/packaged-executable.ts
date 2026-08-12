import fs from "node:fs"
import path from "node:path"

export function packagedExecutable(root: string) {
  return packagedExecutableCandidates(root).find((candidate) => fs.existsSync(candidate))
}

export function packagedExecutableCandidates(root: string) {
  if (process.platform === "win32") {
    return [
      path.join(root, "release", "win-unpacked", "opencodex-gui.exe"),
      path.join(root, "release", "win-unpacked", "OpencodeX.exe"),
    ]
  }
  if (process.platform === "darwin") {
    return [
      path.join(root, "release", "mac", "opencodex-gui.app", "Contents", "MacOS", "opencodex-gui"),
      path.join(root, "release", "mac-arm64", "opencodex-gui.app", "Contents", "MacOS", "opencodex-gui"),
    ]
  }
  return [path.join(root, "release", "linux-unpacked", "opencodex-gui")]
}
