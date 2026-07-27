const boundaries = [
  {
    file: "packages/gui/src/renderer/src/app.tsx",
    forbidden: [
      "applySessionStateSnapshot",
      "applySessionStatusSnapshot",
      "loadGuiCapabilities",
      "patchSessionData",
      "patchSnapshot(",
      "runGlobalEventAction",
      "sessionDataEventTargets",
    ],
  },
  {
    file: "packages/opencode/src/cli/cmd/tui/context/sync.tsx",
    forbidden: [
      'case "message.updated"',
      'case "message.part.updated"',
      'case "message.part.delta"',
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
  },
]

const violations = (
  await Promise.all(
    boundaries.map(async (boundary) => {
      const source = await Bun.file(boundary.file).text()
      return boundary.forbidden.flatMap((token) =>
        source.includes(token) ? [`${boundary.file}: ${token}`] : [],
      )
    }),
  )
).flat()

if (violations.length > 0) {
  console.error("First-party clients must project shared ClientStateSync state; direct reducers found:")
  violations.forEach((violation) => console.error(`- ${violation}`))
  process.exit(1)
}

console.log("Client state boundary: no first-party direct reducers")
