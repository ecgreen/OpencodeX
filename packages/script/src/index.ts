import { $ } from "bun"
import semver from "semver"
import path from "path"

const rootPkgPath = path.resolve(import.meta.dir, "../../../package.json")
const rootPkg = await Bun.file(rootPkgPath).json()
const expectedBunVersion = rootPkg.packageManager?.split("@")[1]

if (!expectedBunVersion) {
  throw new Error("packageManager field not found in root package.json")
}

// relax version requirement
const expectedBunVersionRange = `^${expectedBunVersion}`

if (!semver.satisfies(process.versions.bun, expectedBunVersionRange)) {
  throw new Error(`This script requires bun@${expectedBunVersionRange}, but you are using bun@${process.versions.bun}`)
}

const env = {
  OPENCODE_CHANNEL: process.env["OPENCODE_CHANNEL"],
  OPENCODE_BUMP: process.env["OPENCODE_BUMP"],
  OPENCODE_VERSION: process.env["OPENCODE_VERSION"],
  OPENCODE_RELEASE: process.env["OPENCODE_RELEASE"],
}
const CHANNEL = await (async () => {
  if (env.OPENCODE_CHANNEL) return env.OPENCODE_CHANNEL
  if (env.OPENCODE_BUMP) return "latest"
  if (env.OPENCODE_VERSION && !env.OPENCODE_VERSION.startsWith("0.0.0-")) return "latest"
  return await $`git branch --show-current`.text().then((x) => x.trim())
})()
const IS_PREVIEW = CHANNEL !== "latest"

// The fork's own release state is the source of truth for the version. `release-cli.yml`
// resolves the tag from packages/opencode/package.json and passes it through as
// OPENCODE_VERSION, so this only has to agree with that file — never with upstream's
// npm registry entry, which this fork does not publish to and does not track.
const cliPkgPath = path.resolve(import.meta.dir, "../../opencode/package.json")

const VERSION = await (async () => {
  if (env.OPENCODE_VERSION) return env.OPENCODE_VERSION
  if (IS_PREVIEW) return `0.0.0-${CHANNEL}-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}`
  const declared = await Bun.file(cliPkgPath)
    .json()
    .then((pkg: { version?: string }) => pkg.version)
    .catch(() => undefined)
  const version = (declared ? semver.valid(semver.coerce(declared)) : null) ?? "0.0.0"
  if (version === "0.0.0" && declared !== "0.0.0") {
    console.warn(`unable to read a valid version from ${cliPkgPath}; falling back to 0.0.0`)
  }
  const bump = env.OPENCODE_BUMP?.toLowerCase()
  if (bump === "major" || bump === "minor" || bump === "patch") return semver.inc(version, bump) ?? version
  // No explicit bump: ship exactly what packages/opencode/package.json declares, which is
  // what release-cli.yml validates the release tag against.
  return version
})()

const bot = ["actions-user", "github-actions[bot]"]
const team = ["ecgreen", ...bot]

export const Script = {
  get channel() {
    return CHANNEL
  },
  get version() {
    return VERSION
  },
  get preview() {
    return IS_PREVIEW
  },
  get release(): boolean {
    return !!env.OPENCODE_RELEASE
  },
  get team() {
    return team
  },
}
console.log(`opencodex script`, JSON.stringify(Script, null, 2))
