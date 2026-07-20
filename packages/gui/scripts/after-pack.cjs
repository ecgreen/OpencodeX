const { spawn } = require("node:child_process")

const architectures = {
  0: "ia32",
  1: "x64",
  2: "armv7l",
  3: "arm64",
  4: "universal",
}

module.exports = function afterPack(context) {
  const arch = architectures[context.arch]
  if (!arch) throw new Error(`Unsupported electron-builder architecture: ${context.arch}`)
  return new Promise((resolve, reject) => {
    const child = spawn(
      "bun",
      [
        "run",
        "scripts/package-budget.ts",
        "--app-dir",
        context.appOutDir,
        "--platform",
        context.electronPlatformName,
        "--arch",
        arch,
      ],
      { cwd: context.packager.projectDir, stdio: "inherit" },
    )
    child.once("error", reject)
    child.once("exit", (code) => {
      if (code === 0) return resolve()
      reject(new Error(`Package budget exited with code ${code ?? "unknown"}`))
    })
  })
}
