const paths = [
  ...new Bun.Glob("packages/*/package.json").scanSync({ cwd: import.meta.dir + "/..", onlyFiles: true }),
  "packages/sdk/js/package.json",
]

const missing = (
  await Promise.all(
    paths.map(async (file) => ({
      file,
      manifest: await Bun.file(new URL(`../${file}`, import.meta.url)).json(),
    })),
  )
).flatMap(({ file, manifest }) => {
  if (!manifest.scripts?.test || manifest.scripts["test:ci"]) return []
  return [`${manifest.name ?? file} (${file})`]
})

if (missing.length === 0) process.exit(0)

console.error("Packages with tests must define test:ci:")
missing.forEach((name) => console.error(`- ${name}`))
process.exit(1)
