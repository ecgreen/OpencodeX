// Per-file profiler for finding candidate test-speed work; see ../../perf/test-suite.md
// for the benchmark notes, kept wins, and discarded experiments.
// Example: TEST_PROFILE_GLOB='test/server/**/*.test.ts' TEST_PROFILE_TOP=15 bun run profile:test
const pattern = Bun.env.TEST_PROFILE_GLOB ?? "test/**/*.test.{ts,tsx}"
const limit = Number(Bun.env.TEST_PROFILE_LIMIT ?? 0)
const timeout = Bun.env.TEST_PROFILE_TIMEOUT ?? "30000"
const processTimeout = Number(Bun.env.TEST_PROFILE_PROCESS_TIMEOUT ?? 120_000)
const files = Array.fromAsync(new Bun.Glob(pattern).scan({ cwd: import.meta.dir + "/..", onlyFiles: true }))
  .then((files) => files.toSorted())
  .then((files) => (limit > 0 ? files.slice(0, limit) : files))

const results = []
for (const file of await files) {
  const start = performance.now()
  console.log(`START ${file}`)
  const proc = Bun.spawn(["bun", "test", "--timeout", timeout, file], {
    cwd: import.meta.dir + "/..",
    stdout: "pipe",
    stderr: "pipe",
    env: Bun.env,
  })
  const output = new Response(proc.stdout).text()
  const error = new Response(proc.stderr).text()
  const timedOut = Symbol("timed-out")
  const deadline = Promise.withResolvers<typeof timedOut>()
  const watchdog = setTimeout(() => deadline.resolve(timedOut), processTimeout)
  const result = await Promise.race([proc.exited, deadline.promise])
  clearTimeout(watchdog)
  if (result === timedOut) {
    proc.kill()
    await proc.exited
  }
  const exitCode = result === timedOut ? 124 : result
  const [stdout, stderr] = await Promise.all([output, error])
  const seconds = (performance.now() - start) / 1000
  results.push({ file, seconds, exitCode })
  console.log(`${exitCode === 0 ? "PASS" : result === timedOut ? "TIMEOUT" : "FAIL"} ${seconds.toFixed(3)}s ${file}`)
  if (exitCode !== 0) console.log((stdout + stderr).trim())
  await Bun.write(
    import.meta.dir + "/../.artifacts/test-profile.json",
    JSON.stringify({ updatedAt: new Date().toISOString(), results }, undefined, 2),
  )
}

const sorted = results.toSorted((a, b) => b.seconds - a.seconds)
console.log("\nSlowest test files:")
for (const result of sorted.slice(0, Number(Bun.env.TEST_PROFILE_TOP ?? 20))) {
  console.log(`${result.seconds.toFixed(3)}s ${result.exitCode === 0 ? "PASS" : "FAIL"} ${result.file}`)
}

if (sorted[0]) {
  console.log(`METRIC slowest_test_file_seconds=${sorted[0].seconds.toFixed(3)}`)
  console.log(`METRIC profiled_test_files=${results.length}`)
}

if (results.some((result) => result.exitCode !== 0)) process.exit(1)
