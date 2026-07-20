import type { DiffFile, WorkbenchChangeFile } from "./store"

export type DiffTreeNode =
  | { id: string; type: "directory"; name: string; path: string; children: DiffTreeNode[] }
  | { id: string; type: "file"; name: string; path: string; file: DiffFile }

export type DiffTreeRow = {
  id: string
  type: "directory" | "file"
  name: string
  path: string
  depth: number
  guides: boolean[]
  file?: DiffFile
}

export type WorkbenchChangeTreeRow = {
  id: string
  type: "directory" | "file"
  name: string
  path: string
  parent: string
  depth: number
  guides: boolean[]
  node?: WorkbenchChangeFile
}

type WorkbenchChangeTreeNode =
  | { id: string; type: "directory"; name: string; path: string; children: WorkbenchChangeTreeNode[] }
  | { id: string; type: "file"; name: string; path: string; file: WorkbenchChangeFile }

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

export function flattenDiffFileTree(nodes: DiffTreeNode[], expanded: ReadonlySet<string>, depth = 0, guides: boolean[] = []): DiffTreeRow[] {
  return nodes.flatMap((node): DiffTreeRow[] => {
    const row = {
      id: node.id,
      type: node.type,
      name: node.name,
      path: node.path,
      depth,
      guides,
      ...(node.type === "file" ? { file: node.file } : {}),
    }
    if (node.type === "file" || !expanded.has(node.id)) return [row]
    return [row, ...flattenDiffFileTree(node.children, expanded, depth + 1, [...guides, true])]
  })
}

export function expandedDirectories(nodes: DiffTreeNode[]) {
  return new Set(directoryIDs(nodes))
}

export function flattenWorkbenchChangeTree(
  files: readonly WorkbenchChangeFile[],
  collapsed: ReadonlySet<string>,
): WorkbenchChangeTreeRow[] {
  return flattenWorkbenchNodes(buildWorkbenchChangeTree(files), collapsed)
}

export function reconcileWorkbenchChangeRows(
  current: readonly WorkbenchChangeTreeRow[],
  incoming: readonly WorkbenchChangeTreeRow[],
) {
  const existing = new Map(current.map((row) => [row.id, row]))
  return incoming.map((row) => {
    const previous = existing.get(row.id)
    if (!previous || previous.depth !== row.depth || previous.parent !== row.parent) return row
    return previous
  })
}

function buildWorkbenchChangeTree(files: readonly WorkbenchChangeFile[]) {
  const roots: WorkbenchChangeTreeNode[] = []
  const directories = new Map<string, Extract<WorkbenchChangeTreeNode, { type: "directory" }>>()
  files.forEach((file) => {
    const parts = file.path.split(/[\\/]/).filter(Boolean)
    const parent = parts.slice(0, -1).reduce((state, name) => {
      const directoryPath = state.path ? `${state.path}/${name}` : name
      const existing = directories.get(directoryPath)
      if (existing) return { children: existing.children, path: directoryPath }
      const directory = {
        id: `directory:${directoryPath}`,
        type: "directory" as const,
        name,
        path: directoryPath,
        children: [],
      }
      directories.set(directoryPath, directory)
      state.children.push(directory)
      return { children: directory.children, path: directoryPath }
    }, { children: roots, path: "" })
    parent.children.push({
      id: `file:${file.path}`,
      type: "file",
      name: parts.at(-1) ?? file.path,
      path: file.path,
      file,
    })
  })
  return sortWorkbenchTree(roots)
}

function flattenWorkbenchNodes(
  nodes: readonly WorkbenchChangeTreeNode[],
  collapsed: ReadonlySet<string>,
  parent = "",
  depth = 0,
  guides: boolean[] = [],
): WorkbenchChangeTreeRow[] {
  return nodes.flatMap((node): WorkbenchChangeTreeRow[] => {
    const row = {
      id: node.id,
      type: node.type,
      name: node.name,
      path: node.path,
      parent,
      depth,
      guides,
      ...(node.type === "file" ? { node: node.file } : {}),
    }
    if (node.type === "file" || collapsed.has(node.path)) return [row]
    return [row, ...flattenWorkbenchNodes(node.children, collapsed, node.path, depth + 1, [...guides, true])]
  })
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

function sortWorkbenchTree(nodes: WorkbenchChangeTreeNode[]): WorkbenchChangeTreeNode[] {
  return nodes
    .map((node) => node.type === "directory" ? { ...node, children: sortWorkbenchTree(node.children) } : node)
    .toSorted((left, right) => Number(left.type === "file") - Number(right.type === "file") || left.name.localeCompare(right.name))
}
