const childProcess = require("node:child_process")
const fs = require("node:fs/promises")
const path = require("node:path")

module.exports = async function notarize(context) {
  if (process.platform !== "darwin" || context.electronPlatformName !== "darwin") return

  const missing = ["APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID"].filter((name) => !process.env[name])
  if (missing.length > 0) {
    if (process.env.OPENCODEX_ALLOW_UNSIGNED_GUI === "1") {
      console.warn(`Skipping macOS notarization because ${missing.join(", ")} are missing.`)
      return
    }
    throw new Error(`Missing macOS notarization secrets: ${missing.join(", ")}`)
  }

  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  const zipPath = path.join(context.outDir, `${context.packager.appInfo.productFilename}-notarize.zip`)
  await fs.rm(zipPath, { force: true })
  await execFile("ditto", ["-c", "-k", "--keepParent", appPath, zipPath])
  await execFile("xcrun", [
    "notarytool",
    "submit",
    zipPath,
    "--apple-id",
    process.env.APPLE_ID,
    "--password",
    process.env.APPLE_APP_SPECIFIC_PASSWORD,
    "--team-id",
    process.env.APPLE_TEAM_ID,
    "--wait",
  ])
  await execFile("xcrun", ["stapler", "staple", appPath])
  await fs.rm(zipPath, { force: true })
}

function execFile(command, args) {
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn(command, args, { stdio: "inherit" })
    child.on("error", reject)
    child.on("exit", (code) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`${command} exited with code ${code ?? "unknown"}`))
    })
  })
}
