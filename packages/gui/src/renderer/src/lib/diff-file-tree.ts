import type { DiffFile } from "./store"

export type DiffTreeNode =
  | { id: string; type: "directory"; name: string; path: string; children: DiffTreeNode[] }
  | { id: string; type: "file"; name: string; path: string; file: DiffFile }

export type DiffTreeRow = {
  id: string
  type: "directory" | "file"
  name: string
  path: string
  depth: number
  file?: DiffFile
}

export function buildDiffFileTree(files: DiffFile[]): DiffTreeNode[] {
  const roots: DiffTreeNode[] = []
  const directories = new Map<string, Extract<DiffTreeNode, { type: "directory" }>>()

  for (const file of files) {
    const filePath = file.file
    if (!filePath) continue
    const parts = filePath.split(/[\\/]/).filter(Boolean)
    let children = roots
    let parentPath = ""
    parts.slice(0, -1).forEach((part) => {
      const path = parentPath ? `${parentPath}/${part}` : part
      const existing = directories.get(path)
      if (existing) {
        children = existing.children
        parentPath = path
        return
      }
      const directory = { id: `dir:${path}`, type: "directory" as const, name: part, path, children: [] }
      directories.set(path, directory)
      children.push(directory)
      children = directory.children
      parentPath = path
    })
    children.push({
      id: `file:${filePath}`,
      type: "file",
      name: parts.at(-1) ?? filePath,
      path: filePath,
      file,
    })
  }

  return sortTree(roots)
}

export function flattenDiffFileTree(nodes: DiffTreeNode[], expanded: ReadonlySet<string>, depth = 0): DiffTreeRow[] {
  return nodes.flatMap((node): DiffTreeRow[] => {
    const row = {
      id: node.id,
      type: node.type,
      name: node.name,
      path: node.path,
      depth,
      ...(node.type === "file" ? { file: node.file } : {}),
    }
    if (node.type === "file" || !expanded.has(node.id)) return [row]
    return [row, ...flattenDiffFileTree(node.children, expanded, depth + 1)]
  })
}

export function expandedDirectories(nodes: DiffTreeNode[]) {
  return new Set(directoryIDs(nodes))
}

export function moveDiffSelection(rows: DiffTreeRow[], currentID: string, offset: number) {
  if (rows.length === 0) return ""
  const index = Math.max(0, rows.findIndex((row) => row.id === currentID))
  return rows[(index + offset + rows.length) % rows.length]?.id ?? rows[0].id
}

export function nextDiffFile(files: DiffFile[], current: string, offset: number) {
  if (files.length === 0) return ""
  const index = Math.max(0, files.findIndex((file) => file.file === current))
  return files[(index + offset + files.length) % files.length]?.file ?? files[0].file
}

function directoryIDs(nodes: DiffTreeNode[]): string[] {
  return nodes.flatMap((node) => node.type === "directory" ? [node.id, ...directoryIDs(node.children)] : [])
}

function sortTree(nodes: DiffTreeNode[]): DiffTreeNode[] {
  return nodes
    .map((node) => node.type === "directory" ? { ...node, children: sortTree(node.children) } : node)
    .toSorted((a, b) => Number(a.type === "file") - Number(b.type === "file") || a.name.localeCompare(b.name))
}
