import { join } from "node:path"

type ManifestChunk = {
  file: string
  isEntry?: boolean
  imports?: string[]
}

type BundleCategory = "app" | "css" | "syntax" | "worker"

const kib = 1024
const outputDirectory = join(import.meta.dir, "..", "dist", "renderer")
const manifestPath = join(outputDirectory, ".vite", "manifest.json")
const manifestFile = Bun.file(manifestPath)

if (!(await manifestFile.exists())) {
  console.error("Renderer manifest is missing. Build the renderer before checking bundle sizes.")
  process.exit(1)
}

const manifest = (await manifestFile.json()) as Record<string, ManifestChunk>
const sourcesByFile = new Map<string, string[]>()

Object.entries(manifest).forEach(([source, chunk]) => {
  sourcesByFile.set(chunk.file, [...(sourcesByFile.get(chunk.file) ?? []), source.replaceAll("\\", "/")])
})

const files = await Array.fromAsync(
  new Bun.Glob("**/*.{js,css}").scan({
    cwd: outputDirectory,
    onlyFiles: true,
  }),
)

const measured = await Promise.all(
  files.map(async (file) => {
    const bytes = new Uint8Array(await Bun.file(join(outputDirectory, file)).arrayBuffer())
    return {
      file: file.replaceAll("\\", "/"),
      raw: bytes.byteLength,
      gzip: Bun.gzipSync(bytes).byteLength,
    }
  }),
)

const category = (file: string): BundleCategory => {
  if (file.endsWith(".css")) return "css"
  if (file.includes("/worker-")) return "worker"
  if (
    (sourcesByFile.get(file) ?? []).some((source) =>
      /node_modules\/(?:@shikijs\/(?:langs|themes)|shiki\/dist\/wasm|@shikijs\/engine-oniguruma\/dist\/wasm-inlined)/.test(
        source,
      ),
    )
  )
    return "syntax"
  return "app"
}

const limits = {
  app: { raw: 550 * kib, gzip: 165 * kib },
  css: { raw: 650 * kib, gzip: 100 * kib },
  syntax: { raw: 800 * kib, gzip: 250 * kib },
  worker: { raw: 250 * kib, gzip: 80 * kib },
} satisfies Record<BundleCategory, { raw: number; gzip: number }>

const entry = Object.entries(manifest).find(([, chunk]) => chunk.isEntry)
if (!entry) {
  console.error("Renderer manifest does not contain an entry chunk.")
  process.exit(1)
}

const startupKeys = new Set<string>()
const visitStartupChunk = (key: string) => {
  if (startupKeys.has(key)) return
  startupKeys.add(key)
  manifest[key]?.imports?.forEach(visitStartupChunk)
}
visitStartupChunk(entry[0])

const startupFiles = new Set(
  [...startupKeys]
    .map((key) => manifest[key]?.file)
    .filter((file): file is string => !!file && file.endsWith(".js")),
)
const startup = measured.filter((file) => startupFiles.has(file.file))
const startupSize = startup.reduce(
  (total, file) => ({ raw: total.raw + file.raw, gzip: total.gzip + file.gzip }),
  { raw: 0, gzip: 0 },
)

const failures = measured.flatMap((file) => {
  const fileCategory = category(file.file)
  const limit = limits[fileCategory]
  const violations = [
    file.raw > limit.raw ? `raw ${format(file.raw)} > ${format(limit.raw)}` : "",
    file.gzip > limit.gzip ? `gzip ${format(file.gzip)} > ${format(limit.gzip)}` : "",
  ].filter(Boolean)
  if (!violations.length) return []
  return [`${file.file} (${fileCategory}): ${violations.join(", ")}`]
})

const startupLimit = { raw: 550 * kib, gzip: 150 * kib }
if (startupSize.raw > startupLimit.raw || startupSize.gzip > startupLimit.gzip) {
  failures.push(
    `startup JavaScript: raw ${format(startupSize.raw)} / gzip ${format(startupSize.gzip)} ` +
      `(limits ${format(startupLimit.raw)} / ${format(startupLimit.gzip)})`,
  )
}

console.log(`Startup JavaScript: ${format(startupSize.raw)} raw / ${format(startupSize.gzip)} gzip`)
console.table(
  measured
    .sort((left, right) => right.raw - left.raw)
    .slice(0, 12)
    .map((file) => ({
      file: file.file,
      category: category(file.file),
      raw: format(file.raw),
      gzip: format(file.gzip),
    })),
)

if (failures.length) {
  console.error(`Bundle budget failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`)
  process.exit(1)
}

console.log("Bundle budgets passed.")

function format(bytes: number) {
  return `${(bytes / kib).toFixed(1)} KiB`
}
