import { Effect } from "effect"
import { effectCmd, fail } from "../effect-cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { errorMessage } from "@/util/error"
import { runServeAuthority } from "./serve-authority"

export const ServeCommand = effectCmd({
  command: "serve",
  builder: (yargs) => withNetworkOptions(yargs),
  describe: "starts a headless opencode server",
  // Server loads instances per-request via x-opencode-directory header — no
  // need for an ambient project InstanceContext at startup.
  instance: false,
  handler: Effect.fn("Cli.serve")(function* (args) {
    const opts = yield* resolveNetworkOptions(args)
    yield* runServeAuthority(opts).pipe(Effect.catch((error) => fail(errorMessage(error))))
  }),
})
