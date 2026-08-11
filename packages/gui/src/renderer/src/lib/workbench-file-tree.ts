import type { FileNode } from "@opencode-ai/sdk/v2/client"
import { workbenchPathKey } from "./workbench"

export type WorkbenchTreeRow = {
  node: FileNode
  depth: number
  expanded: boolean
  loaded: boolean
}

export function flattenWorkbenchFileTree(input: {
  root: FileNode[]
  children: Record<string, FileNode[]>
  expanded: ReadonlySet<string>
  /** Folders the user explicitly collapsed; wins over filter auto-expansion. */
  collapsed?: ReadonlySet<string>
  filter?: string
  /** Project-wide search hits, revealed in place even under unloaded folders. */
  matches?: readonly FileNode[]
}) {
  const query = input.filter?.trim().toLowerCase() ?? ""
  const virtual = query ? virtualMatchNodes(input.matches ?? []) : { root: [], children: {}, files: new Set<string>() }
  const mergeChildren = (path: string) => {
    const loaded = input.children[path]
    const extra = virtual.children[path] ?? []
    if (!loaded) return extra.length > 0 ? extra : undefined
    const seen = new Set(loaded.map((node) => node.path))
    return [...loaded, ...extra.filter((node) => !seen.has(node.path))]
  }
  const visit = (items: FileNode[], depth: number): WorkbenchTreeRow[] =>
    sortWorkbenchFiles(items).flatMap((node) => {
      const children = node.type === "directory" ? mergeChildren(node.path) : undefined
      const childRows = node.type === "directory" ? visit(children ?? [], depth + 1) : []
      const matches = !query || node.name.toLowerCase().includes(query) || node.path.toLowerCase().includes(query) || virtual.files.has(node.path)
      if (query && !matches && childRows.length === 0) return []
      const expanded = node.type === "directory"
        && !input.collapsed?.has(node.path)
        && (input.expanded.has(node.path) || (!!query && childRows.length > 0))
      const row = {
        node,
        depth,
        expanded,
        loaded: node.type !== "directory" || children !== undefined,
      }
      if (!expanded) return [row]
      return [row, ...childRows]
    })
  const rootSeen = new Set(input.root.map((node) => node.path))
  return visit([...input.root, ...virtual.root.filter((node) => !rootSeen.has(node.path))], 0)
}

/** Ancestor chains for search matches, so hits render as ordinary tree nodes. */
function virtualMatchNodes(matches: readonly FileNode[]) {
  const root: FileNode[] = []
  const children: Record<string, FileNode[]> = {}
  const files = new Set<string>()
  const dirs = new Set<string>()
  const add = (parent: string, node: FileNode) => {
    const bucket = parent ? (children[parent] ??= []) : root
    if (!bucket.some((existing) => existing.path === node.path)) bucket.push(node)
  }
  for (const match of matches) {
    const path = workbenchPathKey(match.path)
    if (!path || match.type === "directory") continue
    files.add(path)
    const parts = path.split("/").filter(Boolean)
    let parent = ""
    parts.slice(0, -1).forEach((name) => {
      const directoryPath = parent ? `${parent}/${name}` : name
      if (!dirs.has(directoryPath)) {
        dirs.add(directoryPath)
        add(parent, { name, path: directoryPath, absolute: "", type: "directory", ignored: false })
      }
      parent = directoryPath
    })
    add(parent, { ...match, name: parts.at(-1) ?? path, path })
  }
  return { root, children, files }
}

function sortWorkbenchFiles(items: FileNode[]) {
  return [...items].sort((left, right) => {
    if (left.type !== right.type) return left.type === "directory" ? -1 : 1
    return left.name.localeCompare(right.name)
  })
}
