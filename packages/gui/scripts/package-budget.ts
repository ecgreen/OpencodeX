import { listPackage, statFile } from "@electron/asar"
import { existsSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import path from "node:path"

const root = path.resolve(import.meta.dirname, "..")
const kib = 1024
const mib = 1024 * kib

export const packageLimits = {
  renderer: 16 * mib,
  main: 64 * kib,
  preload: 8 * kib,
  asar: 16 * mib,
  unpacked: {
    "win32-x64": 2 * mib,
    "win32-arm64": 2 * mib,
    "darwin-x64": 1 * mib,
    "darwin-arm64": 1 * mib,
    "linux-x64": 512 * kib,
    "linux-arm64": 512 * kib,
  },
} as const

export const measuredSidecarBytes = {
  "win32-x64": 123_860_992,
  "linux-x64": 120_084_608,
  "darwin-x64": 94_404_688,
  "darwin-arm64": 88_858_082,
} as const

export const SIDECAR_VERSION_STAMP = "sidecar/version.json"

export function sidecarLimit(platform: string, arch: string) {
  const key = `${platform}-${arch}`
  const measured = Object.entries(measuredSidecarBytes).find(([target]) => target === key)?.[1]
  if (!measured) throw new Error(`No measured GUI coordinator size is defined for ${key}`)
  return measured + Math.min(Math.ceil(measured * 0.05), 2 * mib)
}

export type PackageFile = {
  path: string
  bytes: number
  unpacked?: boolean
}

export type PackageInventory = {
  version: 2
  platform: string
  arch: string
  limits: {
    renderer: number
    main: number
    preload: number
    asar: number
    unpacked: number
    sidecar: number
    resources: number
  }
  totals: {
    renderer: number
    main: number
    preload: number
    asar: number
    unpacked: number
    sidecar: number
    resources: number
  }
  asarFiles: PackageFile[]
  unpackedFiles: PackageFile[]
  sidecarFiles: PackageFile[]
  resourceFiles: PackageFile[]
  pdbFiles: string[]
}

export function expectedPtyNativeFiles(platform: string, arch: string) {
  const directory = `node_modules/@lydell/node-pty-${platform}-${arch}/prebuilds/${platform}-${arch}`
  if (platform === "win32") {
    return [
      `${directory}/conpty_console_list.node`,
      `${directory}/conpty.node`,
      `${directory}/conpty/conpty.dll`,
      `${directory}/conpty/OpenConsole.exe`,
    ]
  }
  if (platform === "darwin") return [`${directory}/pty.node`, `${directory}/spawn-helper`]
  return [`${directory}/pty.node`]
}

export function validatePackageInventory(inventory: PackageInventory) {
  const failures: string[] = []
  const expectedPlatformRoot = `node_modules/@lydell/node-pty-${inventory.platform}-${inventory.arch}`
  const expectedRoots = ["node_modules/@lydell/node-pty", expectedPlatformRoot]
  const expectedNative = expectedPtyNativeFiles(inventory.platform, inventory.arch).sort()
  const asarPaths = inventory.asarFiles.map((file) => file.path)
  const topLevel = [...new Set(asarPaths.map((file) => file.split("/")[0]))].sort()
  const packageRoots = [...new Set(asarPaths.flatMap(packageRoot))].sort()
  const prebuilds = asarPaths.filter((file) => file.includes("/prebuilds/")).sort()
  const markedUnpacked = inventory.asarFiles.filter((file) => file.unpacked).map((file) => file.path).sort()
  const physicalUnpacked = inventory.unpackedFiles.map((file) => file.path).sort()
  const expectedCoordinator = `sidecar/opencode-gui-coordinator${inventory.platform === "win32" ? ".exe" : ""}`
  /* The version stamp travels with the binary: Electron main reads it to
     present this build's backend version in the coordinator handshake. */
  const expectedSidecar = [expectedCoordinator, SIDECAR_VERSION_STAMP].sort()
  const coordinatorBytes = inventory.sidecarFiles.find((file) => file.path === expectedCoordinator)?.bytes ?? 0
  const sidecarBytes = inventory.sidecarFiles.reduce((sum, file) => sum + file.bytes, 0)
  const resourceBytes = inventory.resourceFiles.reduce((sum, file) => sum + file.bytes, 0)

  if (inventory.totals.renderer > inventory.limits.renderer)
    failures.push(`renderer ${format(inventory.totals.renderer)} > ${format(inventory.limits.renderer)}`)
  if (inventory.totals.main > inventory.limits.main)
    failures.push(`main ${format(inventory.totals.main)} > ${format(inventory.limits.main)}`)
  if (inventory.totals.preload > inventory.limits.preload)
    failures.push(`preload ${format(inventory.totals.preload)} > ${format(inventory.limits.preload)}`)
  if (inventory.totals.asar > inventory.limits.asar)
    failures.push(`app.asar ${format(inventory.totals.asar)} > ${format(inventory.limits.asar)}`)
  if (inventory.totals.unpacked > inventory.limits.unpacked)
    failures.push(`app.asar.unpacked ${format(inventory.totals.unpacked)} > ${format(inventory.limits.unpacked)}`)
  if (sidecarBytes > inventory.limits.sidecar)
    failures.push(`GUI coordinator ${format(sidecarBytes)} > ${format(inventory.limits.sidecar)}`)
  if (resourceBytes > inventory.limits.resources)
    failures.push(`packaged resources ${format(resourceBytes)} > ${format(inventory.limits.resources)}`)
  if (inventory.totals.sidecar !== sidecarBytes) failures.push("sidecar byte total does not match its inventory")
  if (inventory.totals.resources !== resourceBytes) failures.push("resource byte total does not match its inventory")
  if (!asarPaths.includes("dist/renderer/index.html")) failures.push("renderer index is missing from app.asar")
  if (!same(asarPaths.filter((file) => file.startsWith("dist/main/")), ["dist/main/index.js"]))
    failures.push("app.asar must contain exactly dist/main/index.js for the Electron main process")
  if (!same(asarPaths.filter((file) => file.startsWith("dist/preload/")), ["dist/preload/index.cjs"]))
    failures.push("app.asar must contain exactly dist/preload/index.cjs for the preload")
  if (!same(topLevel, ["dist", "node_modules", "package.json"]))
    failures.push(`unexpected app.asar roots: ${topLevel.join(", ")}`)
  if (!same(packageRoots, expectedRoots))
    failures.push(`unexpected production package roots: ${packageRoots.join(", ") || "none"}`)
  if (!same(prebuilds, expectedNative)) failures.push(`unexpected PTY prebuilds: ${prebuilds.join(", ") || "none"}`)
  if (!same(markedUnpacked, expectedNative))
    failures.push(`unexpected ASAR unpack markers: ${markedUnpacked.join(", ") || "none"}`)
  if (!same(physicalUnpacked, expectedNative))
    failures.push(`unexpected app.asar.unpacked files: ${physicalUnpacked.join(", ") || "none"}`)
  if (!same(inventory.sidecarFiles.map((file) => file.path), expectedSidecar))
    failures.push(`sidecar must contain only ${expectedSidecar.join(" and ")}`)
  if (coordinatorBytes === 0) failures.push("GUI coordinator is empty")
  if (inventory.pdbFiles.length > 0) failures.push(`PDB files are forbidden: ${inventory.pdbFiles.join(", ")}`)
  return failures
}

export async function inspectPackage(input: { appDir: string; platform: string; arch: string }) {
  const key = `${input.platform}-${input.arch}` as keyof typeof packageLimits.unpacked
  const unpackedLimit = packageLimits.unpacked[key]
  if (!unpackedLimit) throw new Error(`No unpacked package limit is defined for ${key}`)
  const resources = input.platform === "darwin"
    ? path.join(input.appDir, "opencodex-gui.app", "Contents", "Resources")
    : path.join(input.appDir, "resources")
  const archive = path.join(resources, "app.asar")
  if (!existsSync(archive)) throw new Error(`Packaged app.asar is missing: ${archive}`)

  const asarFiles = listPackage(archive, { isPack: false })
    .flatMap((raw): PackageFile[] => {
      const file = normalize(raw)
      if (!file) return []
      const entry = statFile(archive, raw.replace(/^[/\\]+/, ""))
      if (!("size" in entry)) return []
      return [{ path: file, bytes: entry.size, ...(entry.unpacked ? { unpacked: true } : {}) }]
    })
    .sort(byPath)
  const unpackedFiles = await directoryInventory(path.join(resources, "app.asar.unpacked"), "")
  const sidecarFiles = await directoryInventory(path.join(resources, "sidecar"), "sidecar")
  const resourceFiles = await directoryInventory(resources, "")
  const filesystemFiles = await directoryInventory(input.appDir, "")
  const total = (prefix: string) => asarFiles
    .filter((file) => file.path.startsWith(prefix))
    .reduce((sum, file) => sum + file.bytes, 0)

  return {
    version: 2,
    platform: input.platform,
    arch: input.arch,
    limits: {
      renderer: packageLimits.renderer,
      main: packageLimits.main,
      preload: packageLimits.preload,
      asar: packageLimits.asar,
      unpacked: unpackedLimit,
      sidecar: sidecarLimit(input.platform, input.arch),
      resources: sidecarLimit(input.platform, input.arch) + packageLimits.asar + unpackedLimit + 64 * kib,
    },
    totals: {
      renderer: total("dist/renderer/"),
      main: total("dist/main/"),
      preload: total("dist/preload/"),
      asar: Bun.file(archive).size,
      unpacked: unpackedFiles.reduce((sum, file) => sum + file.bytes, 0),
      sidecar: sidecarFiles.reduce((sum, file) => sum + file.bytes, 0),
      resources: resourceFiles.reduce((sum, file) => sum + file.bytes, 0),
    },
    asarFiles,
    unpackedFiles,
    sidecarFiles,
    resourceFiles,
    pdbFiles: [
      ...asarFiles.filter((file) => file.path.toLowerCase().endsWith(".pdb")).map((file) => file.path),
      ...filesystemFiles.filter((file) => file.path.toLowerCase().endsWith(".pdb")).map((file) => file.path),
    ].sort((left, right) => left.localeCompare(right)),
  } satisfies PackageInventory
}

async function directoryInventory(directory: string, prefix: string) {
  if (!existsSync(directory)) return []
  const files = await Array.fromAsync(
    new Bun.Glob("**/*").scan({ cwd: directory, dot: true, onlyFiles: true, followSymlinks: false }),
  )
  return files
    .map((file) => ({
      path: [prefix, normalize(file)].filter(Boolean).join("/"),
      bytes: Bun.file(path.join(directory, file)).size,
    }))
    .sort(byPath)
}

function packageRoot(file: string) {
  if (!file.startsWith("node_modules/")) return []
  const parts = file.split("/")
  return [parts[1]?.startsWith("@") ? parts.slice(0, 3).join("/") : parts.slice(0, 2).join("/")]
}

function normalize(file: string) {
  return file.replace(/^[/\\]+/, "").replaceAll("\\", "/")
}

function same(left: string[], right: string[]) {
  return left.length === right.length && left.every((item, index) => item === right[index])
}

function byPath(left: PackageFile, right: PackageFile) {
  return left.path.localeCompare(right.path)
}

function format(bytes: number) {
  return `${(bytes / kib).toFixed(1)} KiB`
}

function argument(name: string) {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

function defaultAppDirectory(platform: string) {
  const candidates = platform === "win32"
    ? [path.join(root, "release", "win-unpacked")]
    : platform === "darwin"
      ? [path.join(root, "release", "mac"), path.join(root, "release", "mac-arm64")]
      : [path.join(root, "release", "linux-unpacked")]
  return candidates.find(existsSync) ?? candidates[0]
}

if (import.meta.main) {
  const platform = argument("--platform") ?? process.platform
  const arch = argument("--arch") ?? process.arch
  const inventory = await inspectPackage({
    appDir: path.resolve(argument("--app-dir") ?? defaultAppDirectory(platform)),
    platform,
    arch,
  })
  await mkdir(path.join(root, ".artifacts"), { recursive: true })
  const artifact = path.join(root, ".artifacts", `package-inventory-${platform}-${arch}.json`)
  await Bun.write(artifact, `${JSON.stringify(inventory, null, 2)}\n`)
  const failures = validatePackageInventory(inventory)
  console.log(
    `Package sizes: renderer ${format(inventory.totals.renderer)}, main ${format(inventory.totals.main)}, ` +
      `preload ${format(inventory.totals.preload)}, app.asar ${format(inventory.totals.asar)}, ` +
      `unpacked ${format(inventory.totals.unpacked)}, sidecar ${format(inventory.totals.sidecar)}, ` +
      `resources ${format(inventory.totals.resources)}`,
  )
  console.log(`Package inventory: ${artifact}`)
  if (failures.length > 0) throw new Error(`Package budget failed:\n${failures.map((item) => `- ${item}`).join("\n")}`)
  console.log("Package content and size budgets passed.")
}
