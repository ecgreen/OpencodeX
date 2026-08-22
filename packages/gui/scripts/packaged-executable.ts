import fs from "node:fs"
import path from "node:path"

export function packagedExecutable(root: string) {
  return packagedExecutableCandidates(root).find((candidate) => fs.existsSync(candidate))
}

export function packagedExecutableCandidates(root: string, platform: NodeJS.Platform = process.platform) {
  if (platform === "win32") {
    return [
      path.join(root, "release", "win-unpacked", "opencodex-gui.exe"),
      path.join(root, "release", "win-unpacked", "OpencodeX.exe"),
    ]
  }
  if (platform === "darwin") {
    return ["mac", "mac-arm64"].flatMap((arch) =>
      ["OpencodeX.app", "opencodex-gui.app"].map((bundle) =>
        path.join(root, "release", arch, bundle, "Contents", "MacOS", "opencodex-gui"),
      ),
    )
  }
  return [path.join(root, "release", "linux-unpacked", "opencodex-gui")]
}
