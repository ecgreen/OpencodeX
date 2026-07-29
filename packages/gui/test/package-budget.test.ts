import { describe, expect, test } from "bun:test"
import {
  expectedPtyNativeFiles,
  measuredSidecarBytes,
  packageLimits,
  sidecarLimit,
  validatePackageInventory,
  type PackageInventory,
} from "../scripts/package-budget"

describe("Electron package budgets", () => {
  test("accepts only the platform PTY package, native files, and coordinator", () => {
    expect(validatePackageInventory(inventory())).toEqual([])
  })

  test("rejects oversized payloads, build packages, PDBs, and extra unpacked files", () => {
    const invalid = inventory()
    invalid.totals.renderer = invalid.limits.renderer + 1
    invalid.totals.main = invalid.limits.main + 1
    invalid.totals.preload = invalid.limits.preload + 1
    invalid.totals.asar = invalid.limits.asar + 1
    invalid.totals.unpacked = invalid.limits.unpacked + 1
    invalid.totals.sidecar = invalid.limits.sidecar + 1
    invalid.totals.resources = invalid.limits.resources + 1
    invalid.asarFiles.push({ path: "node_modules/vite/package.json", bytes: 1 })
    invalid.unpackedFiles.push({ path: "node_modules/@lydell/node-pty-win32-x64/prebuilds/win32-arm64/conpty.node", bytes: 1 })
    invalid.sidecarFiles.push({ path: "sidecar/README.md", bytes: 1 })
    invalid.pdbFiles.push("node_modules/@lydell/node-pty-win32-x64/prebuilds/win32-x64/conpty.pdb")

    const failures = validatePackageInventory(invalid)
    expect(failures.length).toBeGreaterThanOrEqual(11)
    expect(failures.join("\n")).toContain("renderer")
    expect(failures.join("\n")).toContain("unexpected production package roots")
    expect(failures.join("\n")).toContain("PDB files are forbidden")
    expect(failures.join("\n")).toContain("sidecar must contain only")
  })

  test("rejects arbitrary sidecar growth beyond the measured headroom", () => {
    const invalid = inventory()
    const sidecar = invalid.sidecarFiles[0]
    if (!sidecar) throw new Error("missing sidecar fixture")
    sidecar.bytes = invalid.limits.sidecar + 1
    invalid.totals.sidecar = invalid.limits.sidecar + 1
    invalid.resourceFiles = [...invalid.sidecarFiles]
    invalid.totals.resources = invalid.limits.sidecar + 1

    expect(validatePackageInventory(invalid).join("\n")).toContain("GUI coordinator")
    const measured = measuredSidecarBytes["win32-x64"]
    expect(sidecarLimit("win32", "x64") - measured).toBeLessThanOrEqual(2 * 1024 * 1024)
    expect(sidecarLimit("win32", "x64") - measured).toBeLessThanOrEqual(Math.ceil(measured * 0.05))
  })
})

function inventory(): PackageInventory {
  const native = expectedPtyNativeFiles("win32", "x64")
  return {
    version: 2,
    platform: "win32",
    arch: "x64",
    limits: {
      renderer: packageLimits.renderer,
      main: packageLimits.main,
      preload: packageLimits.preload,
      asar: packageLimits.asar,
      unpacked: packageLimits.unpacked["win32-x64"],
      sidecar: sidecarLimit("win32", "x64"),
      resources:
        sidecarLimit("win32", "x64") + packageLimits.asar + packageLimits.unpacked["win32-x64"] + 64 * 1024,
    },
    totals: { renderer: 1, main: 1, preload: 1, asar: 1, unpacked: 1, sidecar: 2, resources: 2 },
    asarFiles: [
      { path: "dist/electron-metafile.json", bytes: 1 },
      { path: "dist/main/index.js", bytes: 1 },
      { path: "dist/preload/index.cjs", bytes: 1 },
      { path: "dist/renderer/index.html", bytes: 1 },
      { path: "node_modules/@lydell/node-pty/index.js", bytes: 1 },
      { path: "node_modules/@lydell/node-pty-win32-x64/package.json", bytes: 1 },
      ...native.map((file) => ({ path: file, bytes: 1, unpacked: true as const })),
      { path: "package.json", bytes: 1 },
    ],
    unpackedFiles: native.map((file) => ({ path: file, bytes: 1 })),
    sidecarFiles: [
      { path: "sidecar/opencode-gui-coordinator.exe", bytes: 1 },
      { path: "sidecar/version.json", bytes: 1 },
    ],
    resourceFiles: [
      { path: "sidecar/opencode-gui-coordinator.exe", bytes: 1 },
      { path: "sidecar/version.json", bytes: 1 },
    ],
    pdbFiles: [],
  }
}
