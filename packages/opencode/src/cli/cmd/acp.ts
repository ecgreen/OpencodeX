import * as Log from "@opencode-ai/core/util/log"
import { Effect } from "effect"
import { effectCmd, fail } from "../effect-cmd"
import { AgentSideConnection, ndJsonStream } from "@agentclientprotocol/sdk"
import { ACP } from "@/acp/agent"
import { Server } from "@/server/server"
import { ServerAuth } from "@/server/auth"
import { createOpencodeClient } from "@opencode-ai/sdk/v2"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { ACPProfile } from "@/acp/profile"
import { UI } from "../ui"
import {
  acquirePreferredCoordinatorAccess,
  coordinatorHeaders,
  readPreferredCoordinator,
  startCoordinatorClientLease,
} from "./tui/coordinator-registry"
import { createCoordinatorTransport } from "./tui/coordinator-transport"
import { validateServeAuthorityNetwork } from "./serve-authority"
import { errorMessage } from "@/util/error"

const log = Log.create({ service: "acp-command" })

export const AcpCommand = effectCmd({
  command: "acp",
  describe: "start ACP (Agent Client Protocol) server",
  builder: (yargs) => {
    return withNetworkOptions(yargs).option("cwd", {
      describe: "working directory",
      type: "string",
      default: process.cwd(),
    })
  },
  handler: Effect.fn("Cli.acp")(function* (args) {
    ACPProfile.mark("cli.acp.handler")
    process.env.OPENCODE_CLIENT = "acp"
    const opts = yield* resolveNetworkOptions(args)

    // One writer per database: when an authority already serves the preferred
    // database (the TUI coordinator, the GUI sidecar, or `opencode serve`),
    // ACP attaches to it instead of racing a second backend. The requested
    // network options are advisory in that case; the SDK simply points at the
    // existing authority.
    yield* Effect.acquireUseRelease(
      Effect.gen(function* () {
        const access = yield* Effect.promise(() => acquirePreferredCoordinatorAccess())
        const coordinator = access.coordinator
        if (coordinator) {
          UI.println(
            UI.Style.TEXT_WARNING_BOLD + "!",
            UI.Style.TEXT_NORMAL,
            `requested network listener options were not used: this database already has an authority (pid ${coordinator.pid}, url ${coordinator.url})`,
          )
          const lease = startCoordinatorClientLease(coordinator.key)
          yield* Effect.promise(() => lease.ready).pipe(
            Effect.onError(() => Effect.sync(() => lease.dispose())),
            Effect.onError(() => Effect.promise(() => access.release()).pipe(Effect.ignore)),
          )
          const reattaching = createCoordinatorTransport({
            manifest: coordinator,
            resolve: async () => {
              const next = await readPreferredCoordinator()
              if (!next) throw new Error("No local authority available to recover")
              return next
            },
          })
          return {
            sdk: createOpencodeClient({
              baseUrl: coordinator.url,
              headers: coordinatorHeaders(coordinator),
              fetch: reattaching.fetch,
            }),
            release: Effect.sync(() => lease.dispose()).pipe(Effect.andThen(Effect.promise(() => access.release()))),
          }
        }

        yield* validateServeAuthorityNetwork({
          hostname: opts.hostname,
          password: process.env.OPENCODE_SERVER_PASSWORD ?? "",
          allowInsecureLan: process.env.OPENCODE_SERVER_ALLOW_INSECURE_LAN,
        }).pipe(Effect.onError(() => Effect.promise(() => access.release()).pipe(Effect.ignore)))
        const server = yield* Effect.tryPromise(() =>
          ACPProfile.measure("cli.acp.server.listen", () => Server.listen(opts)),
        ).pipe(Effect.onError(() => Effect.promise(() => access.release()).pipe(Effect.ignore)))
        return {
          sdk: createOpencodeClient({
            baseUrl: `http://${server.hostname}:${server.port}`,
            headers: ServerAuth.headers(),
          }),
          release: Effect.all([Effect.tryPromise(() => server.stop(true)), Effect.promise(() => access.release())], {
            discard: true,
          }),
        }
      }),
      (backend) =>
        Effect.gen(function* () {
          const input = new WritableStream<Uint8Array>({
            write(chunk) {
              return new Promise<void>((resolve, reject) => {
                process.stdout.write(chunk, (err) => {
                  if (err) return reject(err)
                  resolve()
                })
              })
            },
          })
          const output = new ReadableStream<Uint8Array>({
            start(controller) {
              process.stdin.on("data", (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)))
              process.stdin.on("end", () => controller.close())
              process.stdin.on("error", (err) => controller.error(err))
            },
          })
          const agent = ACP.init({ sdk: backend.sdk })
          new AgentSideConnection(
            (conn) => {
              ACPProfile.mark("cli.acp.connection.create")
              return agent.create(conn)
            },
            ndJsonStream(input, output),
          )

          log.info("setup connection")
          process.stdin.resume()
          yield* Effect.promise(
            () =>
              new Promise<void>((resolve, reject) => {
                process.stdin.on("end", () => resolve())
                process.stdin.on("error", reject)
              }),
          )
        }),
      (backend) => backend.release.pipe(Effect.ignore),
    ).pipe(Effect.catch((error) => fail(errorMessage(error))))
  }),
})
