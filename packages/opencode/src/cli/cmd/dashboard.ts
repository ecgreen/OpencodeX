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
    stdout.write(
      "\x1b[2mPersistent conversation dashboard. Arrow keys move; Enter opens a conversation; n starts a new one; q exits.\x1b[0m\n\n",
    )

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

    const move = (delta: number) => {
      const next = Math.max(0, Math.min(items.length - 1, selected + delta))
      if (next === selected) return false
      selected = next
      return true
    }

    const onData = (chunk: string) => {
      let shouldRender = false

      for (let index = 0; index < chunk.length; index++) {
        const key = chunk[index]
        if (key === "\u0003" || key === "q") {
          cleanup()
          return
        }
        if (key === "\r" || key === "\n") {
          cleanup(items[selected])
          return
        }
        if (key === "n") {
          cleanup({ type: "new" })
          return
        }
        if (key === "k" || key === "h") {
          shouldRender = move(-1) || shouldRender
          continue
        }
        if (key === "j" || key === "l") {
          shouldRender = move(1) || shouldRender
          continue
        }
        if (key !== "\x1b") continue

        const arrow = chunk.slice(index, index + 3)
        if (arrow === "\x1b[A" || arrow === "\x1b[D") {
          shouldRender = move(-1) || shouldRender
          index += 2
          continue
        }
        if (arrow === "\x1b[B" || arrow === "\x1b[C") {
          shouldRender = move(1) || shouldRender
          index += 2
          continue
        }

        cleanup()
        return
      }

      if (shouldRender) render()
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
