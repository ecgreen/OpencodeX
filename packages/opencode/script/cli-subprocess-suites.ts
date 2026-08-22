/*
 * The suites that spawn the real CLI as a subprocess, via test/lib/cli-process.
 *
 * They run as their own CI task rather than inside test:ci, because they are
 * sensitive to what the rest of the job has already done to the machine. Run in
 * isolation on the Windows runner the four run-process cases take 3.5-18.4s;
 * run at the tail of the full job on comparable hardware the same four take
 * 10.1-48.5s, a ~3.3x stretch that also hits the case which never contacts the
 * LLM server - so it is CLI startup being slowed down, not the network path.
 *
 * That degradation is real and unexplained; splitting the suites out sidesteps
 * it rather than fixing it. What it buys is honest coverage on both platforms
 * plus a shorter unit job, plus a signal that stays readable if it regresses.
 */
export const cliSubprocessSuites = [
  "test/cli/acp/config-options.test.ts",
  "test/cli/acp/initialize-auth.test.ts",
  "test/cli/acp/lifecycle.test.ts",
  "test/cli/acp/prompt-content.test.ts",
  "test/cli/acp/skills.test.ts",
  "test/cli/help/help-snapshots.test.ts",
  "test/cli/run/run-process.test.ts",
  "test/cli/serve/authority-attach.test.ts",
  "test/cli/serve/serve-process.test.ts",
  "test/cli/smokes/read-only.test.ts",
]
