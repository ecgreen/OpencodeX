import { Effect } from "effect"
import { EOL } from "os"
import { effectCmd } from "../effect-cmd"
import { Session } from "@/session/session"
import { Locale } from "@/util/locale"
import { Process } from "@/util/process"

type DashboardItem =
  | { type: "new" }
  | {
      type: "session"
      session: Session.GlobalInfo
    }

export const DashboardCommand = effectCmd({
  command: "dashboard",
  aliases: ["dash", "x"],
  describe: "show the OpencodeX multi-session dashboard",
  instance: false,
  builder: (yargs) =>
    yargs
      .option("max-count", {
        alias: "n",
        describe: "limit to N most recent conversations",
        type: "number",
        default: 40,
      })
      .option("format", {
        describe: "output format",
        type: "string",
        choices: ["interactive", "table", "json"],
        default: "interactive",
      }),
  handler: Effect.fn("Cli.dashboard")(function* (args) {
    const sessions = yield* Session.Service.use((svc) => svc.listGlobal({ roots: true, limit: args.maxCount }))

    if (args.format === "json") {
      console.log(JSON.stringify(sessions.map(sessionJSON), null, 2))
      return
    }

    if (args.format === "table" || !process.stdin.isTTY || !process.stdout.isTTY) {
      console.log(formatTable(sessions))
      return
    }

    const selected = yield* Effect.promise(() =>
      selectDashboardItem([{ type: "new" }, ...sessions.map((session) => ({ type: "session", session }) as const)]),
    )
    if (!selected) return

    yield* Effect.promise(() => openDashboardItem(selected))
  }),
})

function sessionJSON(session: Session.GlobalInfo) {
  return {
    id: session.id,
    title: session.title,
    updated: session.time.updated,
    created: session.time.created,
    projectId: session.projectID,
    project: session.project,
    directory: session.directory,
  }
}

function formatTable(sessions: Session.GlobalInfo[]) {
  if (sessions.length === 0) return "No opencode conversations found yet."
  return [
    "OpencodeX Dashboard",
    "",
    "Recent conversations",
    ...sessions.map((session) => {
      const updated = Locale.todayTimeOrDateTime(session.time.updated).padEnd(16)
      const title = Locale.truncate(session.title, 44).padEnd(44)
      const directory = Locale.truncate(session.directory, 36)
      return `${updated} ${title} ${session.id} ${directory}`
    }),
    "",
    "Open a conversation: opencodex --session <session-id>",
  ].join(EOL)
}

async function selectDashboardItem(items: DashboardItem[]) {
  const stdin = process.stdin
  const stdout = process.stdout
  const raw = stdin.isRaw
  const previousEncoding = stdin.readableEncoding
  let selected = 0

  const render = () => {
    stdout.write("\x1b[2J\x1b[H")
    stdout.write("OpencodeX\n")
    stdout.write("\x1b[2mPersistent conversation dashboard. Enter opens a conversation; n starts a new one; q exits.\x1b[0m\n\n")

    for (const [index, item] of items.entries()) {
      const active = index === selected
      stdout.write(active ? "\x1b[7m" : "")
      stdout.write(renderItem(item))
      stdout.write(active ? "\x1b[0m" : "")
      stdout.write("\n")
    }
  }

  stdout.write("\x1b[?1049h\x1b[?25l")
  stdin.setEncoding("utf8")
  stdin.setRawMode(true)
  stdin.resume()
  render()

  return await new Promise<DashboardItem | undefined>((resolve) => {
    const cleanup = (item?: DashboardItem) => {
      stdin.off("data", onData)
      stdin.setRawMode(raw)
      if (previousEncoding) stdin.setEncoding(previousEncoding)
      stdin.pause()
      stdout.write("\x1b[?25h\x1b[?1049l")
      resolve(item)
    }

    const onData = (chunk: string) => {
      if (chunk === "\u0003" || chunk === "q" || chunk === "\x1b") {
        cleanup()
        return
      }
      if (chunk === "\r" || chunk === "\n") {
        cleanup(items[selected])
        return
      }
      if (chunk === "n") {
        cleanup({ type: "new" })
        return
      }
      if (chunk === "\x1b[A" || chunk === "k") {
        selected = Math.max(0, selected - 1)
        render()
        return
      }
      if (chunk === "\x1b[B" || chunk === "j") {
        selected = Math.min(items.length - 1, selected + 1)
        render()
      }
    }

    stdin.on("data", onData)
  })
}

function renderItem(item: DashboardItem) {
  if (item.type === "new") return "  + New conversation"
  const updated = Locale.todayTimeOrDateTime(item.session.time.updated).padEnd(15)
  const title = Locale.truncate(item.session.title, 46).padEnd(46)
  const directory = Locale.truncate(item.session.directory, 42)
  return `  ${updated}  ${title}  ${directory}`
}

async function openDashboardItem(item: DashboardItem) {
  const command = process.argv[1]?.endsWith(".ts") ? [process.execPath, process.argv[1]] : [process.execPath]
  const args = item.type === "session" ? ["--session", item.session.id] : []
  const cwd = item.type === "session" ? item.session.directory : process.cwd()
  const child = Process.spawn([...command, ...args], {
    cwd,
    env: item.type === "new" ? { OPENCODEX_DASHBOARD: "0" } : undefined,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  })
  process.exitCode = await child.exited
}
