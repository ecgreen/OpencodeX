import { builtinModules } from "node:module"
import { lstat, mkdir, readdir, readlink, rm } from "node:fs/promises"
import path from "node:path"

const root = path.resolve(import.meta.dirname, "..")
const builtins = new Set(
  builtinModules.flatMap((name) => {
    const bare = name.replace(/^node:/, "")
    return [bare, `node:${bare}`]
  }),
)

export const electronExternals = ["electron", "@lydell/node-pty", "node:*", ...builtins].sort()

const BUNDLE_ATTEMPTS = 2

export function allowedElectronExternal(specifier: string) {
  return specifier === "electron" || specifier === "@lydell/node-pty" || specifier.startsWith("node:") || builtins.has(specifier)
}

export function validateElectronMetafile(metafile: Bun.BuildMetafile) {
  return [
    ...new Set(
      Object.values(metafile.inputs).flatMap((input) =>
        input.imports
          .filter((item) => item.external)
          .flatMap((item) => {
            const specifier = item.original ?? item.path
            if (!allowedElectronExternal(specifier)) return [specifier]
            if (specifier === "node:sqlite" && item.kind !== "dynamic-import") {
              return [`${specifier} must remain a dynamic development-only import`]
            }
            return []
          }),
      ),
    ),
  ].sort((left, right) => left.localeCompare(right))
}

export async function buildElectron(outputRoot = path.join(root, "dist")) {
  const mainDirectory = path.join(outputRoot, "main")
  const preloadDirectory = path.join(outputRoot, "preload")
  await Promise.all([
    rm(mainDirectory, { recursive: true, force: true }),
    rm(preloadDirectory, { recursive: true, force: true }),
  ])
  await Promise.all([mkdir(mainDirectory, { recursive: true }), mkdir(preloadDirectory, { recursive: true })])

  const [main, preload] = await Promise.all([
    bundle({
      entrypoint: path.join(root, "src", "main", "index.ts"),
      outdir: mainDirectory,
      naming: "index.js",
      format: "esm",
    }),
    bundle({
      entrypoint: path.join(root, "src", "preload", "index.cts"),
      outdir: preloadDirectory,
      naming: "index.cjs",
      format: "cjs",
    }),
  ])

  const unexpected = [
    ...validateElectronMetafile(main.metafile),
    ...validateElectronMetafile(preload.metafile),
  ]
  if (unexpected.length > 0) {
    throw new Error(`Electron build has unexpected external imports:\n${unexpected.map((item) => `- ${item}`).join("\n")}`)
  }

  await assertOutput(mainDirectory, "index.js")
  await assertOutput(preloadDirectory, "index.cjs")
  await assertDevelopmentOnlySqlite(main.metafile, path.join(mainDirectory, "index.js"))
  const metadata = {
    version: 1,
    externals: electronExternals,
    builds: {
      main: normalizeMetafile(main.metafile),
      preload: normalizeMetafile(preload.metafile),
    },
  }
  await Bun.write(path.join(outputRoot, "electron-metafile.json"), `${JSON.stringify(metadata, null, 2)}\n`)
  return metadata
}

async function bundle(input: {
  entrypoint: string
  outdir: string
  naming: string
  format: "esm" | "cjs"
}) {
  for (let attempt = 1; ; attempt++) {
    const result = await Bun.build({
      entrypoints: [input.entrypoint],
      outdir: input.outdir,
      naming: input.naming,
      target: "node",
      format: input.format,
      conditions: ["node"],
      external: electronExternals,
      minify: true,
      splitting: false,
      sourcemap: "none",
      metafile: true,
      throw: false,
    })
    if (result.success && result.metafile) return { metafile: result.metafile }

    /* Bun's reporter prints an AggregateError's contents, never its message,
       so the description has to reach stderr on its own. */
    const details = await describeBlamedFiles(result.logs)
    if (retryableRead(result.logs) && attempt < BUNDLE_ATTEMPTS) {
      console.error(`Retrying ${input.entrypoint} after a transient read failure:\n${details.join("\n")}`)
      continue
    }
    if (details.length > 0) console.error(`Files blamed while bundling ${input.entrypoint}:\n${details.join("\n")}`)
    throw new AggregateError(result.logs, `Failed to bundle ${input.entrypoint}`)
  }
}

/*
 * Bun names the errno behind a read failure, and every cause worth acting on
 * gets its own message - EACCES, ELOOP, and a missing file all say so. Only
 * "Unexpected" is the unmapped fallback, which is what a loaded CI runner
 * produces for inputs that stat and read back intact microseconds later.
 * Retry that one case; anything with a real errno still fails on the spot.
 */
function retryableRead(logs: readonly unknown[]) {
  return logs.some((log) => /Unexpected reading file:/.test(String((log as { message?: string })?.message ?? log)))
}

/*
 * Bun reports read failures as `<errno> reading file: "<path>"` and falls back
 * to "Unexpected" for anything it does not map, which on its own says nothing
 * about why a dependency became unreadable. Describe each blamed path so the
 * failure is actionable from a CI log alone.
 */
async function describeBlamedFiles(logs: readonly unknown[]) {
  const paths = new Set<string>()
  for (const log of logs) {
    const message = String((log as { message?: string })?.message ?? log)
    for (const match of message.matchAll(/"((?:[A-Za-z]:)?[\\/][^"]+)"/g)) paths.add(match[1]!)
  }
  return Promise.all([...paths].map(describeFile))
}

async function describeFile(file: string) {
  const link = await lstat(file).catch((error: NodeJS.ErrnoException) => error)
  if (link instanceof Error) return `${file}: lstat failed (${link.code ?? link.message})`
  const target = link.isSymbolicLink() ? ` -> ${await readlink(file).catch(() => "unreadable")}` : ""
  const kind = link.isSymbolicLink() ? "symlink" : link.isDirectory() ? "directory" : link.isFile() ? "file" : "special"
  const read = await Bun.file(file).arrayBuffer().then(
    (buffer) => `read ${buffer.byteLength} bytes`,
    (error: NodeJS.ErrnoException) => `read failed (${error.code ?? error.message})`,
  )
  return `${file}: ${kind}${target}, size ${link.size}, mode ${(link.mode & 0o777).toString(8)}, links ${link.nlink}, ${read}`
}

async function assertOutput(directory: string, filename: string) {
  const entries = (await readdir(directory)).sort()
  if (entries.length === 1 && entries[0] === filename) return
  throw new Error(`Expected only ${filename} in ${directory}, found: ${entries.join(", ") || "nothing"}`)
}

async function assertDevelopmentOnlySqlite(metafile: Bun.BuildMetafile, output: string) {
  const imports = Object.values(metafile.inputs).flatMap((input) => input.imports)
  const sqlite = imports.filter((item) => (item.original ?? item.path) === "node:sqlite")
  if (sqlite.length !== 1 || sqlite[0]?.kind !== "dynamic-import" || !sqlite[0].external) {
    throw new Error("Electron main must contain exactly one external dynamic import for development-only node:sqlite")
  }
  const development = imports.filter((item) =>
    /(?:^|\/)sidecar-development\.(?:js|ts)$/.test((item.original ?? item.path).replaceAll("\\", "/")),
  )
  if (development.length !== 1 || development[0]?.kind !== "dynamic-import") {
    throw new Error("Electron main must load sidecar-development.ts with a dynamic import")
  }
  const content = await Bun.file(output).text()
  if (!content.includes('import("node:sqlite")')) {
    throw new Error("Electron main output does not preserve the dynamic node:sqlite import")
  }
  if (/from["']node:sqlite["']|require\(["']node:sqlite["']\)/.test(content)) {
    throw new Error("Electron main output statically loads development-only node:sqlite")
  }
}

function normalizeMetafile(metafile: Bun.BuildMetafile): Bun.BuildMetafile {
  return {
    inputs: Object.fromEntries(
      Object.entries(metafile.inputs).map(([file, input]) => [normalizePath(file), {
        ...input,
        imports: input.imports.map(normalizeImport),
      }]),
    ),
    outputs: Object.fromEntries(
      Object.entries(metafile.outputs).map(([file, output]) => [normalizePath(file), {
        ...output,
        entryPoint: output.entryPoint ? normalizePath(output.entryPoint) : undefined,
        cssBundle: output.cssBundle ? normalizePath(output.cssBundle) : undefined,
        imports: output.imports.map(normalizeImport),
        inputs: Object.fromEntries(
          Object.entries(output.inputs).map(([input, value]) => [normalizePath(input), value]),
        ),
      }]),
    ),
  }
}

function normalizeImport(item: Bun.BuildMetafile["inputs"][string]["imports"][number]) {
  const normalized = { ...item, path: normalizePath(item.original ?? item.path) }
  delete normalized.original
  return normalized
}

function normalizePath(file: string) {
  return (path.isAbsolute(file) ? path.relative(root, file) : file).replaceAll("\\", "/")
}

if (import.meta.main) {
  await buildElectron()
  console.log("Electron main and preload bundles built with validated externals.")
}
