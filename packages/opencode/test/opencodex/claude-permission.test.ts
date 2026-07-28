import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { decideWith, permissionMetadata, permissionPatterns, questionInfos, withQuestionAnswers } from "../../src/opencodex/claude-permission"
import type { Permission } from "../../src/permission"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { CLAUDE_CONTROL_FLOW } from "../../src/opencodex/claude-driver"
import { normalizeToolName } from "../../src/opencodex/claude-mapper"

describe("decideWith", () => {
  const sessionID = "ses_test" as Parameters<ReturnType<typeof decideWith>>[0]["sessionID"]

  /** Records what reached `Permission.ask` and resolves it as an approval. */
  function recordingPermission() {
    const calls: Permission.AskInput[] = []
    const service = {
      ask: (input: Permission.AskInput) => {
        calls.push(input)
        return Effect.void
      },
      reply: () => Effect.void,
      list: () => Effect.succeed([]),
    } as unknown as Permission.Interface
    return { calls, service }
  }

  const unusedQuestion = {
    ask: () => Effect.die("Question.ask should not be reached for a non-question tool"),
  } as never

  test("forwards the caller's ruleset to Permission.ask", async () => {
    const permission = recordingPermission()
    const decide = decideWith(permission.service, unusedQuestion)
    const ruleset: Permission.Ruleset = [
      { permission: "*", pattern: "*", action: "allow" },
      { permission: "bash", pattern: "*", action: "ask" },
    ]

    const decision = await Effect.runPromise(
      decide({ sessionID, toolName: "Bash", toolInput: { command: "git status --short" }, ruleset }),
    )

    expect(decision).toEqual({ allow: true })
    // Regression: this was hard-coded to `[]`, which made `evaluate` fall back
    // to its implicit "ask" and prompt for every tool call regardless of the
    // user's permission_mode.
    expect(permission.calls).toHaveLength(1)
    expect(permission.calls[0]?.ruleset).toEqual(ruleset)
    expect(permission.calls[0]?.permission).toBe("bash")
  })

  test("passes an auto-mode ruleset through intact, so nothing is re-added downstream", async () => {
    const permission = recordingPermission()
    const decide = decideWith(permission.service, unusedQuestion)
    // What `applyPermissionMode("auto")` produces: prompts flipped to allow,
    // explicit denials preserved.
    const ruleset: Permission.Ruleset = [
      { permission: "*", pattern: "*", action: "allow" },
      { permission: "repo_clone", pattern: "*", action: "deny" },
    ]

    await Effect.runPromise(decide({ sessionID, toolName: "Write", toolInput: { file_path: "a.ts" }, ruleset }))

    expect(permission.calls[0]?.ruleset).toEqual(ruleset)
    expect(permission.calls[0]?.ruleset).not.toHaveLength(0)
  })
})

describe("CLAUDE_CONTROL_FLOW", () => {
  test("exempts exactly the tools Claude cannot recover from being denied", () => {
    // Pinned against the mapper so renaming a normalized id breaks here rather
    // than silently blocking Claude's control flow.
    expect(normalizeToolName("ExitPlanMode")).toBe("plan_exit")
    expect(CLAUDE_CONTROL_FLOW.map((rule) => rule.permission)).toEqual(["plan_exit"])
    expect(CLAUDE_CONTROL_FLOW.every((rule) => rule.action === "allow")).toBe(true)
  })

  test("wins over the default deny when appended last", () => {
    // The default ruleset denies plan_exit; `evaluate` is last-match-wins, so
    // appending the exemption is what keeps plan mode usable in a mirrored session.
    const defaults: Permission.Ruleset = [
      { permission: "*", pattern: "*", action: "allow" },
      { permission: "plan_exit", pattern: "*", action: "deny" },
    ]
    expect(PermissionV2.evaluate("plan_exit", "*", defaults).action).toBe("deny")
    expect(PermissionV2.evaluate("plan_exit", "*", [...defaults, ...CLAUDE_CONTROL_FLOW]).action).toBe("allow")
  })
})

describe("questionInfos", () => {
  test("parses the AskUserQuestion payload into the Question service shape", () => {
    const parsed = questionInfos({
      questions: [
        {
          question: "Which auth method should we use?",
          header: "Auth method",
          multiSelect: false,
          options: [
            { label: "OAuth", description: "Redirect-based flow" },
            { label: "API key", description: "Static secret" },
          ],
        },
      ],
    })
    expect(parsed).toEqual([
      {
        question: "Which auth method should we use?",
        header: "Auth method",
        options: [
          { label: "OAuth", description: "Redirect-based flow" },
          { label: "API key", description: "Static secret" },
        ],
        multiple: false,
        custom: true,
      },
    ])
  })

  test("maps multiSelect onto multiple and tolerates missing descriptions", () => {
    const parsed = questionInfos({
      questions: [
        {
          question: "Which features do you want?",
          header: "Features",
          multiSelect: true,
          options: [{ label: "Dark mode" }, { label: "Sync" }],
        },
      ],
    })
    expect(parsed?.[0]?.multiple).toBe(true)
    expect(parsed?.[0]?.options).toEqual([
      { label: "Dark mode", description: "" },
      { label: "Sync", description: "" },
    ])
  })

  test("returns undefined for anything that is not a question payload, so it falls back to a permission card", () => {
    expect(questionInfos({})).toBeUndefined()
    expect(questionInfos({ questions: [] })).toBeUndefined()
    expect(questionInfos({ questions: [{ header: "no question text" }] })).toBeUndefined()
    expect(questionInfos({ questions: [{ question: "ok?", options: [{ notLabel: true }] }] })).toBeUndefined()
  })
})

describe("withQuestionAnswers", () => {
  const questions = [
    { question: "Which library?", header: "Library", options: [], multiple: false, custom: true },
    { question: "Which features?", header: "Features", options: [], multiple: true, custom: true },
  ]

  test("keys answers by the full question text, the CLI's permission-component contract", () => {
    const input = { questions: [{ question: "Which library?" }] }
    const updated = withQuestionAnswers(input, questions, [["date-fns"], ["Dark mode", "Sync"]])
    expect(updated.answers).toEqual({
      "Which library?": "date-fns",
      "Which features?": "Dark mode, Sync",
    })
    // The original input travels along unchanged.
    expect(updated.questions).toBe(input.questions)
  })

  test("skips questions the user left unanswered rather than sending empty strings", () => {
    const updated = withQuestionAnswers({}, questions, [[], ["Sync"]])
    expect(updated.answers).toEqual({ "Which features?": "Sync" })
  })
})

describe("permissionPatterns", () => {
  test("bash remembers the executable, not the full invocation", () => {
    expect(permissionPatterns("bash", { command: "git status --short" })).toEqual(["git"])
  })

  test("file tools remember the path", () => {
    expect(permissionPatterns("edit", { file_path: "C:/repo/a.ts" })).toEqual(["C:/repo/a.ts"])
  })

  test("webfetch remembers the host", () => {
    expect(permissionPatterns("webfetch", { url: "https://example.com/docs/page" })).toEqual(["example.com"])
  })
})

describe("permissionMetadata", () => {
  test("maps Claude's edit input onto the filepath/diff shape the card reads", () => {
    const metadata = permissionMetadata("edit", {
      file_path: "src/server/auth.ts",
      old_string: "return { token }",
      new_string: "return { token, refresh }",
    })
    expect(metadata.filepath).toBe("src/server/auth.ts")
    expect(String(metadata.diff)).toContain("-return { token }")
    expect(String(metadata.diff)).toContain("+return { token, refresh }")
    // The raw input still travels along for the technical view.
    expect(metadata.old_string).toBe("return { token }")
  })

  test("write renders as a new-file diff", () => {
    const metadata = permissionMetadata("write", { file_path: "notes.md", content: "hello\n" })
    expect(metadata.filepath).toBe("notes.md")
    expect(String(metadata.diff)).toContain("+hello")
  })

  test("read maps file_path to the filePath key the summary reads", () => {
    expect(permissionMetadata("read", { file_path: "README.md" }).filePath).toBe("README.md")
  })

  test("leaves other tools untouched", () => {
    const input = { url: "https://example.com" }
    expect(permissionMetadata("webfetch", input)).toBe(input)
  })
})
