import { afterAll, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises"
import path from "node:path"
import { buildElectron, validateElectronMetafile } from "../scripts/build-electron"
import { packagedExecutableCandidates } from "../scripts/packaged-executable"

const artifacts = path.join(import.meta.dirname, "..", ".artifacts")
await mkdir(artifacts, { recursive: true })
const output = await mkdtemp(path.join(artifacts, "electron-build-test-"))

afterAll(() => rm(output, { recursive: true, force: true }))

describe("Electron bundling", () => {
  test("discovers both supported macOS bundle names", () => {
    const candidates = packagedExecutableCandidates("/repo", "darwin")
    expect(candidates.filter((candidate) => candidate.split(path.sep).includes("OpencodeX.app"))).toHaveLength(2)
    expect(candidates.filter((candidate) => candidate.split(path.sep).includes("opencodex-gui.app"))).toHaveLength(2)
  })

  test("emits deterministic single-file bundles and rejects unexpected externals", async () => {
    const first = await buildElectron(output)
    const firstMain = await Bun.file(path.join(output, "main", "index.js")).text()
    const firstPreload = await Bun.file(path.join(output, "preload", "index.cjs")).text()
    await Bun.write(path.join(output, "main", "stale.js"), "stale")
    await Bun.write(path.join(output, "preload", "stale.cjs"), "stale")

    const second = await buildElectron(output)
    expect(await readdir(path.join(output, "main"))).toEqual(["index.js"])
    expect(await readdir(path.join(output, "preload"))).toEqual(["index.cjs"])
    expect(await Bun.file(path.join(output, "main", "index.js")).text()).toBe(firstMain)
    expect(await Bun.file(path.join(output, "preload", "index.cjs")).text()).toBe(firstPreload)
    expect(firstMain).toContain('from"electron"')
    expect(firstMain).toContain('import("@lydell/node-pty")')
    expect(firstMain).toContain('import("node:sqlite")')
    expect(firstMain).not.toMatch(/from["']node:sqlite["']|require\(["']node:sqlite["']\)/)
    expect(firstMain).not.toContain(".exit(0)")
    expect(firstMain).not.toContain(".exit(1)")
    expect(firstMain).toContain(".exitCode=")
    expect(firstPreload).toContain('require("electron")')
    expect(firstMain).not.toContain("opencodex:restart")
    expect(firstPreload).not.toContain("opencodex:restart")
    const sqliteImports = Object.values(second.builds.main.inputs)
      .flatMap((input) => input.imports)
      .filter((item) => item.path === "node:sqlite")
    expect(sqliteImports).toEqual([{ path: "node:sqlite", kind: "dynamic-import", external: true }])
    expect(
      Object.values(second.builds.main.inputs)
        .flatMap((input) => input.imports)
        .filter((item) => /(?:^|\/)sidecar-development\.(?:js|ts)$/.test(item.path)),
    ).toEqual([expect.objectContaining({ kind: "dynamic-import" })])
    expect(validateElectronMetafile(second.builds.main)).toEqual([])
    expect(validateElectronMetafile(second.builds.preload)).toEqual([])
    expect(JSON.stringify(second)).not.toContain(path.resolve(import.meta.dirname, "../../.."))
    expect(first).toEqual(second)

    const invalid = structuredClone(second.builds.main)
    const input = Object.values(invalid.inputs)[0]
    input.imports.push({ path: "unexpected-runtime", kind: "import-statement", external: true })
    expect(validateElectronMetafile(invalid)).toEqual(["unexpected-runtime"])
  }, 30_000)
})
