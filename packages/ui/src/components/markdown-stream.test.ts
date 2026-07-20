import { describe, expect, test } from "bun:test"
import { stream } from "./markdown-stream"

describe("markdown stream", () => {
  test("heals incomplete emphasis while streaming", () => {
    expect(stream("hello **world", true)).toEqual([{ raw: "hello **world", src: "hello **world**", mode: "live" }])
    expect(stream("say `code", true)).toEqual([{ raw: "say `code", src: "say `code`", mode: "live" }])
  })

  test("keeps incomplete links non-clickable until they finish", () => {
    expect(stream("see [docs](https://example.com/gu", true)).toEqual([
      { raw: "see [docs](https://example.com/gu", src: "see docs", mode: "live" },
    ])
  })

  test("splits an unfinished trailing code fence from stable content", () => {
    expect(stream("before\n\n```ts\nconst x = 1", true)).toEqual([
      { raw: "before\n\n", src: "before\n\n", mode: "full" },
      { raw: "```ts\nconst x = 1", src: "const x = 1", mode: "open-fence", language: "ts" },
    ])
  })

  test("freezes complete top-level blocks and keeps one live tail", () => {
    expect(stream("# Plan\n\nFinished paragraph.\n\n- live item", true)).toEqual([
      { raw: "# Plan\n\n", src: "# Plan\n\n", mode: "full" },
      { raw: "Finished paragraph.\n\n", src: "Finished paragraph.\n\n", mode: "full" },
      { raw: "- live item", src: "- live item", mode: "live" },
    ])
  })

  test("keeps fence metadata out of open escaped code", () => {
    expect(stream("```ts title=example\nconst x = 1\n", true)).toEqual([
      {
        raw: "```ts title=example\nconst x = 1\n",
        src: "const x = 1\n",
        mode: "open-fence",
        language: "ts",
      },
    ])
  })

  test("keeps reference-style markdown as one block", () => {
    expect(stream("[docs][1]\n\n[1]: https://example.com", true)).toEqual([
      {
        raw: "[docs][1]\n\n[1]: https://example.com",
        src: "[docs][1]\n\n[1]: https://example.com",
        mode: "live",
      },
    ])
  })

  test("keeps compact and multiline reference definitions with their uses", () => {
    expect(stream("[docs]\n\n   [docs]:/guide", true)).toEqual([
      {
        raw: "[docs]\n\n   [docs]:/guide",
        src: "[docs]\n\n   [docs]:/guide",
        mode: "live",
      },
    ])
    expect(stream("[docs][id]\n\n[id]:\n  /guide", true)).toEqual([
      {
        raw: "[docs][id]\n\n[id]:\n  /guide",
        src: "[docs][id]\n\n[id]:\n  /guide",
        mode: "live",
      },
    ])
  })
})
