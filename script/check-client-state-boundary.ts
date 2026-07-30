/**
 * First-party clients (GUI renderer, TUI) must project shared ClientStateSync
 * state instead of re-implementing the server's reducer. This walks both client
 * trees and fails on any hand-written reducer token, so a second reducer cannot
 * reappear in a file the guard was never told about.
 */
const trees = ["packages/gui/src/renderer/src", "packages/opencode/src/cli/cmd/tui"]

/** Hand-written session reducers, forbidden anywhere in the scanned client trees. */
const reducerTokens = [
  'case "message.updated"',
  'case "message.part.updated"',
  'case "message.part.delta"',
  'case "message.removed"',
  'case "message.part.removed"',
  "patchSessionData",
  "patchSnapshot(",
  "applySessionStatusSnapshot",
  "applySessionStateSnapshot",
]

/**
 * Capability reads the TUI sync context must take from shared sync state rather
 * than fetching itself. Action handlers elsewhere may still call the SDK, so
 * these are scoped to the sync context alone.
 */
const scopedTokens: Record<string, string[]> = {
  "packages/opencode/src/cli/cmd/tui/context/sync.tsx": [
    'case "permission.asked"',
    'case "question.asked"',
    'case "session.status"',
    "sdk.client.app.agents(",
    "sdk.client.command.list(",
    "sdk.client.config.providers(",
    "sdk.client.formatter.status(",
    "sdk.client.lsp.status(",
    "sdk.client.mcp.status(",
  ],
}

/**
 * Legitimate reducer-token hits, as `file -> tokens`. Each entry states why the
 * file is not a reducer. An entry that stops matching fails the check, so the
 * list cannot rot.
 */
const allowlist: Record<string, string[]> = {
  // Routing only: `collectTuiLiveDetailChanges` maps live events to the session,
  // message, and part IDs that need re-projecting. It never reconstructs
  // message content - the shared sync state still owns every value.
  "packages/opencode/src/cli/cmd/tui/context/sync-state.ts": [
    'case "message.updated"',
    'case "message.part.updated"',
    'case "message.part.delta"',
    'case "message.removed"',
    'case "message.part.removed"',
  ],
}

const isTestFile = (file: string) =>
  /\.test\.tsx?$/.test(file) || /(?:^|\/)(?:__tests__|__mocks__|test|tests)\//.test(file)

const scanned: string[] = []
const violations: string[] = []
const matchedAllowlist = new Set<string>()

for (const tree of trees) {
  const files = (await Array.fromAsync(new Bun.Glob("**/*.{ts,tsx}").scan({ cwd: tree })))
    .map((file) => `${tree}/${file.replaceAll("\\", "/")}`)
    .filter((file) => !isTestFile(file))
    .toSorted()
  scanned.push(...files)
  for (const file of files) {
    const source = await Bun.file(file).text()
    const allowed = allowlist[file] ?? []
    for (const token of [...reducerTokens, ...(scopedTokens[file] ?? [])]) {
      if (!source.includes(token)) continue
      if (!allowed.includes(token)) {
        violations.push(`${file}: ${token}`)
        continue
      }
      matchedAllowlist.add(`${file}: ${token}`)
    }
  }
}

const staleAllowlist = Object.entries(allowlist).flatMap(([file, tokens]) =>
  tokens.filter((token) => !matchedAllowlist.has(`${file}: ${token}`)).map((token) => `${file}: ${token}`),
)
const missingScope = Object.keys(scopedTokens).filter((file) => !scanned.includes(file))

if (violations.length > 0) {
  console.error("First-party clients must project shared ClientStateSync state; direct reducers found:")
  violations.forEach((violation) => console.error(`- ${violation}`))
  process.exit(1)
}

if (staleAllowlist.length > 0 || missingScope.length > 0) {
  console.error("Client state boundary guard is out of date; prune these entries:")
  staleAllowlist.forEach((entry) => console.error(`- unused allowlist entry: ${entry}`))
  missingScope.forEach((file) => console.error(`- scoped file no longer exists: ${file}`))
  process.exit(1)
}

console.log(
  [
    `Client state boundary: no first-party direct reducers.`,
    `Scanned ${scanned.length} non-test client files (${trees.join(", ")})`,
    `for ${reducerTokens.length} reducer tokens, plus ${Object.values(scopedTokens).flat().length} scoped capability tokens in ${Object.keys(scopedTokens).length} file(s);`,
    `${Object.values(allowlist).flat().length} allowlisted hit(s).`,
  ].join(" "),
)
