import type { InstanceContext } from "@/project/instance-context"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import path from "path"

export function workbenchRoots(instance: InstanceContext) {
  return [...new Set([
    instance.directory,
    ...(instance.opencodex?.folders ?? []),
    ...(instance.worktree === "/" ? [] : [instance.worktree]),
  ].map((root) => path.resolve(root)))]
}

export function workbenchReadPath(input: string, root: string | undefined, instance: InstanceContext) {
  const selected = root
    ? workbenchRoots(instance).find((candidate) => samePath(candidate, root))
    : instance.directory
  if (!selected || (root && path.isAbsolute(input))) return
  const resolved = path.resolve(path.isAbsolute(input) ? input : path.join(selected, input))
  if (!AppFileSystem.contains(selected, resolved)) return
  return resolved
}

export function workbenchFileTarget(file: string, instance: InstanceContext) {
  const resolved = path.resolve(file)
  const root = workbenchRoots(instance)
    .filter((candidate) => AppFileSystem.contains(candidate, resolved))
    .sort((a, b) => b.length - a.length)[0]
  if (!root) return
  const relative = path.relative(root, resolved)
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return
  const readOnly = !samePath(root, instance.directory) || relative.split(path.sep).includes("node_modules")
  return {
    path: relative.replaceAll("\\", "/"),
    ...(samePath(root, instance.directory) ? {} : { root: root.replaceAll("\\", "/") }),
    ...(readOnly ? { readOnly: true as const } : {}),
  }
}

function samePath(left: string, right: string) {
  const normalize = (value: string) => process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value)
  return normalize(left) === normalize(right)
}
