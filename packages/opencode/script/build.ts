#!/usr/bin/env bun

import { $ } from "bun"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { createSolidTransformPlugin } from "@opentui/solid/bun-plugin"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "..")

process.chdir(dir)

const generated = await import("./generate.ts")

import { Script } from "@opencode-ai/script"
import pkg from "../package.json"

const singleFlag = process.argv.includes("--single")
const baselineFlag = process.argv.includes("--baseline")
const skipInstall = process.argv.includes("--skip-install")
const sourcemapsFlag = process.argv.includes("--sourcemaps")
const noMinify = process.argv.includes("--no-minify")
const guiCoordinatorFlag = process.argv.includes("--gui-coordinator")
const plugin = createSolidTransformPlugin()
const targetFlag = (() => {
  const idx = process.argv.indexOf("--target")
  return idx !== -1 && idx + 1 < process.argv.length ? process.argv[idx + 1] : undefined
})()

function bunTarget(name: string) {
  switch (name) {
    case "opencode-linux-arm64":
      return "bun-linux-arm64"
    case "opencode-linux-x64":
      return "bun-linux-x64"
    case "opencode-linux-x64-baseline":
      return "bun-linux-x64-baseline"
    case "opencode-linux-arm64-musl":
      return "bun-linux-arm64-musl"
    case "opencode-linux-x64-musl":
      return "bun-linux-x64-musl"
    case "opencode-linux-x64-baseline-musl":
      return "bun-linux-x64-baseline-musl"
    case "opencode-darwin-arm64":
      return "bun-darwin-arm64"
    case "opencode-darwin-x64":
      return "bun-darwin-x64"
    case "opencode-darwin-x64-baseline":
      return "bun-darwin-x64-baseline"
    case "opencode-windows-arm64":
      return "bun-windows-arm64"
    case "opencode-windows-x64":
      return "bun-windows-x64"
    case "opencode-windows-x64-baseline":
      return "bun-windows-x64-baseline"
  }
  throw new Error(`No Bun compile target is defined for ${name}`)
}

const allTargets: {
  os: string
  arch: "arm64" | "x64"
  abi?: "musl"
  avx2?: false
}[] = [
  {
    os: "linux",
    arch: "arm64",
  },
  {
    os: "linux",
    arch: "x64",
  },
  {
    os: "linux",
    arch: "x64",
    avx2: false,
  },
  {
    os: "linux",
    arch: "arm64",
    abi: "musl",
  },
  {
    os: "linux",
    arch: "x64",
    abi: "musl",
  },
  {
    os: "linux",
    arch: "x64",
    abi: "musl",
    avx2: false,
  },
  {
    os: "darwin",
    arch: "arm64",
  },
  {
    os: "darwin",
    arch: "x64",
  },
  {
    os: "darwin",
    arch: "x64",
    avx2: false,
  },
  {
    os: "win32",
    arch: "arm64",
  },
  {
    os: "win32",
    arch: "x64",
  },
  {
    os: "win32",
    arch: "x64",
    avx2: false,
  },
]

const targets = targetFlag
  ? allTargets.filter((item) => {
      // --target flag: match against the generated artifact name suffix
      // e.g. --target win32-x64-baseline matches { os: "win32", arch: "x64", avx2: false }
      const suffix = [item.os, item.arch, item.avx2 === false ? "baseline" : undefined, item.abi]
        .filter(Boolean)
        .join("-")
      return suffix === targetFlag
    })
  : singleFlag
    ? allTargets.filter((item) => {
        if (item.os !== process.platform || item.arch !== process.arch) {
          return false
        }

        // When building for the current platform, prefer a single native binary by default.
        // Baseline binaries require additional Bun artifacts and can be flaky to download.
        if (item.avx2 === false) {
          return baselineFlag
        }

        // also skip abi-specific builds for the same reason
        if (item.abi !== undefined) {
          return false
        }

        return true
      })
    : allTargets

if (targetFlag && targets.length === 0) {
  throw new Error(
    `Unsupported build target: ${targetFlag}. Expected one of ${allTargets
      .map((item) =>
        [item.os, item.arch, item.avx2 === false ? "baseline" : undefined, item.abi].filter(Boolean).join("-"),
      )
      .join(", ")}`,
  )
}
if (targets.length === 0) throw new Error(`No build target matches ${process.platform}-${process.arch}`)

await $`rm -rf dist`

const binaries: Record<string, string> = {}
if (!skipInstall) {
  await $`bun install --frozen-lockfile --os="*" --cpu="*"`
}
for (const item of targets) {
  const name = [
    pkg.name,
    // changing to win32 flags npm for some reason
    item.os === "win32" ? "windows" : item.os,
    item.arch,
    item.avx2 === false ? "baseline" : undefined,
    item.abi === undefined ? undefined : item.abi,
  ]
    .filter(Boolean)
    .join("-")
  console.log(`building ${name}`)
  await $`mkdir -p dist/${name}/bin`

  const parserWorker = guiCoordinatorFlag
    ? undefined
    : fs.realpathSync(
        fs.existsSync(path.resolve(dir, "node_modules/@opentui/core/parser.worker.js"))
          ? path.resolve(dir, "node_modules/@opentui/core/parser.worker.js")
          : path.resolve(dir, "../../node_modules/@opentui/core/parser.worker.js"),
      )
  const workerPath = "./src/cli/cmd/tui/worker.ts"

  // Use platform-specific bunfs root path based on target OS
  const bunfsRoot = item.os === "win32" ? "B:/~BUN/root/" : "/$bunfs/root/"
  const workerRelativePath = parserWorker ? path.relative(dir, parserWorker).replaceAll("\\", "/") : undefined
  const artifact = guiCoordinatorFlag ? "opencode-gui-coordinator" : "opencode"
  const entrypoints = guiCoordinatorFlag
    ? ["./src/gui-coordinator.ts"]
    : parserWorker
      ? ["./src/index.ts", parserWorker, workerPath]
      : []
  if (entrypoints.length === 0) throw new Error("Missing OpenTUI parser worker")

  const result = await Bun.build({
    conditions: ["browser"],
    tsconfig: "./tsconfig.json",
    plugins: guiCoordinatorFlag ? [] : [plugin],
    external: ["node-gyp"],
    format: "esm",
    minify: !noMinify,
    sourcemap: sourcemapsFlag ? "linked" : "none",
    splitting: true,
    compile: {
      autoloadBunfig: false,
      autoloadDotenv: false,
      autoloadTsconfig: true,
      autoloadPackageJson: true,
      target: bunTarget(name),
      outfile: `dist/${name}/bin/${artifact}`,
      execArgv: [`--user-agent=opencode/${Script.version}`, "--use-system-ca", "--"],
      windows: {},
    },
    entrypoints,
    define: {
      OPENCODE_VERSION: `'${Script.version}'`,
      OPENCODE_MODELS_DEV: generated.modelsData,
      ...(workerRelativePath
        ? {
            OTUI_TREE_SITTER_WORKER_PATH: bunfsRoot + workerRelativePath,
            OPENCODE_WORKER_PATH: workerPath,
          }
        : {}),
      OPENCODE_CHANNEL: `'${Script.channel}'`,
      OPENCODE_LIBC: item.os === "linux" ? `'${item.abi ?? "glibc"}'` : "",
    },
  })
  if (!result.success) throw new AggregateError(result.logs, `Build failed for ${name}`)

  const binaryPath = path.resolve(`dist/${name}/bin/${artifact}${item.os === "win32" ? ".exe" : ""}`)
  const binary = Bun.file(binaryPath)
  if (!(await binary.exists()) || binary.size < 1024)
    throw new Error(`Missing or empty binary for ${name}: ${binaryPath}`)
  const header = Buffer.from(await binary.slice(0, 4).arrayBuffer()).toString("hex")
  const validHeader =
    (item.os === "win32" && header.startsWith("4d5a")) ||
    (item.os === "linux" && header === "7f454c46") ||
    (item.os === "darwin" && ["feedface", "feedfacf", "cefaedfe", "cffaedfe"].includes(header))
  if (!validHeader) throw new Error(`Invalid ${item.os} binary header for ${name}: ${header}`)

  // Smoke test: only run if binary is for current platform
  if (!guiCoordinatorFlag && item.os === process.platform && item.arch === process.arch && !item.abi) {
    console.log(`Running smoke test: ${binaryPath} --version`)
    try {
      const versionOutput = await $`${binaryPath} --version`.text()
      console.log(`Smoke test passed: ${versionOutput.trim()}`)
    } catch (e) {
      console.error(`Smoke test failed for ${name}:`, e)
      process.exit(1)
    }
  }

  await $`rm -rf ./dist/${name}/bin/tui`
  await Bun.file(`dist/${name}/package.json`).write(
    JSON.stringify(
      {
        name,
        version: Script.version,
        preferUnplugged: true,
        os: [item.os],
        cpu: [item.arch],
      },
      null,
      2,
    ),
  )
  binaries[name] = Script.version
}

if (Script.release) {
  for (const key of Object.keys(binaries)) {
    if (key.includes("linux")) {
      await $`tar -czf ../../${key}.tar.gz *`.cwd(`dist/${key}/bin`)
    } else {
      await $`zip -r ../../${key}.zip *`.cwd(`dist/${key}/bin`)
    }
  }
  await $`gh release upload v${Script.version} ./dist/*.zip ./dist/*.tar.gz --clobber --repo ${process.env.GH_REPO}`
}

export { binaries }
