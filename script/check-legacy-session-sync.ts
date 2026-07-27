const roots = ["packages/gui/src", "packages/opencode/src/cli/cmd/tui"]
const forbidden = [
  "/experimental/opencodex/session-sync",
  "loadClientSessionSync",
  "legacy-session-sync",
  ".opencodex.session.sync(",
]

const violations = (
  await Promise.all(
    roots.map(async (root) =>
      (
        await Promise.all(
          (await Array.fromAsync(new Bun.Glob("**/*.{ts,tsx}").scan({ cwd: root, absolute: true }))).map(
            async (file) => {
              const source = await Bun.file(file).text()
              return forbidden.flatMap((token) => (source.includes(token) ? [`${file}: ${token}`] : []))
            },
          ),
        )
      ).flat(),
    ),
  )
).flat()

if (violations.length > 0) {
  console.error("First-party clients must use ClientStateSync; legacy session-sync references found:")
  violations.forEach((violation) => console.error(`- ${violation}`))
  process.exit(1)
}

console.log("Legacy session-sync boundary: no first-party references")
