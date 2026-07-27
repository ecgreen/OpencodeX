import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "..")

process.chdir(dir)

const snapshot = process.env.MODELS_DEV_API_JSON ?? path.join(dir, "test/tool/fixtures/models-api.json")
const checksum = process.env.MODELS_DEV_API_SHA256
  ? process.env.MODELS_DEV_API_SHA256.trim().toLowerCase()
  : await Bun.file(path.join(dir, "test/tool/fixtures/models-api.sha256"))
      .text()
      .then((value) => value.trim())

export const modelsData = await Bun.file(snapshot).text()
const digest = new Bun.CryptoHasher("sha256").update(modelsData).digest("hex")
if (digest !== checksum) throw new Error(`Models snapshot checksum mismatch: expected ${checksum}, received ${digest}`)
console.log(`Loaded pinned models.dev snapshot ${digest.slice(0, 12)}`)
