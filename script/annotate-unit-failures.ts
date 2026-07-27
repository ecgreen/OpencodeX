#!/usr/bin/env bun
/*
 * Actions logs need authentication even on a public repo, and the junit
 * artifact needs it too, so a failing unit job is opaque to anyone without
 * repo access. Workflow annotations are the one channel that stays readable,
 * but Bun only annotates assertion failures - a module that fails to resolve,
 * or an unhandled rejection between tests, exits 1 while emitting nothing.
 * Turbo compounds it by prefixing every line with its task id, which stops the
 * runner from parsing whatever ::error:: Bun did emit.
 *
 * Replay the captured log into annotations so the failure survives.
 */

const MAX_ANNOTATIONS = 8
const CONTEXT_BEFORE = 10
const CONTEXT_AFTER = 12
const TAIL_LINES = 60

const logPath = process.argv[2]
if (!logPath) throw new Error("usage: annotate-unit-failures.ts <log-file>")

const file = Bun.file(logPath)
if (!(await file.exists())) {
  console.log(`No unit log at ${logPath}; nothing to annotate.`)
  process.exit(0)
}

const lines = (await file.text()).split(/\r?\n/)

/* Turbo writes "@scope/pkg:task: <line>". Keep the task, drop the prefix. */
function split(line: string) {
  const match = line.match(/^([@\w./-]+:[\w:-]+): ?(.*)$/)
  return match ? { task: match[1]!, text: match[2]! } : { task: undefined, text: line }
}

const interesting =
  /(^|\s)(error:|Cannot find module|Could not resolve|error TS\d|Unhandled error|panic:|Segmentation fault)|^\(fail\)/

const seen = new Set<string>()
const blocks: { task?: string; body: string }[] = []
let consumed = -1

for (let index = 0; index < lines.length && blocks.length < MAX_ANNOTATIONS; index++) {
  const { task, text } = split(lines[index]!)
  if (!interesting.test(text)) continue

  /* A single fault prints a message, then a stack, then turbo's summary of it.
     Once a block covers a region, later hits inside it are the same fault. */
  if (index <= consumed) continue

  /* One annotation per distinct message; a resolution error repeats per importer. */
  const key = `${task ?? ""}|${text.trim()}`
  if (seen.has(key)) continue
  seen.add(key)
  consumed = index + CONTEXT_AFTER - 1

  const body = lines
    .slice(Math.max(0, index - CONTEXT_BEFORE), index + CONTEXT_AFTER)
    .map((line) => split(line).text)
    .join("\n")
    .trim()
  blocks.push({ task, body })
}

/* Nothing matched the patterns - the tail is still better than an opaque exit. */
if (blocks.length === 0) {
  const tail = lines.slice(-TAIL_LINES).join("\n").trim()
  if (tail) blocks.push({ task: undefined, body: tail })
}

/* Workflow commands are line-oriented; literal newlines would end the command. */
function encode(value: string) {
  return value.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A")
}

for (const block of blocks) {
  const title = block.task ? `unit failure: ${block.task}` : "unit failure"
  console.log(`::error title=${encode(title)}::${encode(block.body)}`)
}

console.log(`Annotated ${blocks.length} failure block(s) from ${logPath}.`)
