import { existsSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"

export namespace Module {
  export function resolve(id: string, dir: string): string | undefined {
    try {
      return createRequire(path.join(dir, "package.json")).resolve(id)
    } catch {
      const parts = id.split("/")
      const packageParts = id.startsWith("@") ? parts.slice(0, 2) : parts.slice(0, 1)
      const subpath = parts.slice(packageParts.length)
      if (
        packageParts.length === 0 ||
        subpath.length === 0 ||
        packageParts.some((part) => !part) ||
        subpath.some((part) => !part || part === "." || part === "..")
      )
        return undefined
      for (const current of ancestors(path.resolve(dir))) {
        const candidate = path.join(current, "node_modules", ...packageParts, ...subpath)
        if (existsSync(candidate)) return candidate
      }
    }
    return undefined
  }
}

function ancestors(dir: string): string[] {
  const parent = path.dirname(dir)
  return parent === dir ? [dir] : [dir, ...ancestors(parent)]
}
