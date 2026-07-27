import path from "path"

const root = path.resolve(import.meta.dirname, "..")
const response = await fetch(
  `${(process.env.OPENCODE_MODELS_URL ?? "https://models.dev").replace(/\/+$/, "")}/api.json`,
)
if (!response.ok) throw new Error(`Models update failed: ${response.status} ${response.statusText}`)
const models = await response.text()
JSON.parse(models)
const digest = new Bun.CryptoHasher("sha256").update(models).digest("hex")

await Bun.write(path.join(root, "test/tool/fixtures/models-api.json"), models)
await Bun.write(path.join(root, "test/tool/fixtures/models-api.sha256"), `${digest}\n`)
console.log(`Updated pinned models.dev snapshot: ${digest}`)
