const source = new Bun.Glob("src/**/*.{ts,tsx,css}")
const files = await Array.fromAsync(source.scan({ cwd: import.meta.dirname + "/..", absolute: true }))
const oversized = (
  await Promise.all(
    files.map(async (path) => ({
      path: path.replaceAll("\\", "/").split("/packages/gui/").at(-1) ?? path,
      lines: (await Bun.file(path).text()).split(/\r?\n/).length,
    })),
  )
).filter((file) => file.lines >= 500)

if (oversized.length > 0) {
  throw new Error(
    `GUI source files must stay under 500 lines:\n${oversized.map((file) => `${file.path}: ${file.lines}`).join("\n")}`,
  )
}

console.log(`Checked ${files.length} GUI source files; all are under 500 lines.`)
