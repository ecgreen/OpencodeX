import type { PermissionRequest, QuestionAnswer, QuestionRequest } from "@opencode-ai/sdk/v2/client"
import { Show, createSignal } from "solid-js"
import { SessionSafetyDock } from "../session-safety-dock"
import { Button, useToast } from "../ui"
import { Section } from "./lab-shared"
import styles from "./lab.module.css"

/**
 * Renders the real safety dock - the same components the session page mounts -
 * against a mock transcript-and-composer stage, so the permission and question
 * cards can be reviewed and interacted with outside Electron. Three stages
 * cover the queue's shapes: permissions alone, questions alone, and the
 * grouped combination.
 */

const MOCK_DIFF = [
  "--- a/src/server/auth.ts",
  "+++ b/src/server/auth.ts",
  "@@ -12,7 +12,9 @@ export function createSession(user: User) {",
  '   const token = sign({ sub: user.id }, SECRET, { expiresIn: "7d" })',
  "-  return { token }",
  "+  const refresh = sign({ sub: user.id, kind: \"refresh\" }, SECRET, { expiresIn: \"30d\" })",
  "+  audit.log(\"session.created\", { user: user.id })",
  "+  return { token, refresh }",
  " }",
].join("\n")

function mockPermissions(): PermissionRequest[] {
  return [
    {
      id: "perm_lab_bash",
      sessionID: "ses_lab",
      permission: "bash",
      patterns: ["bun"],
      metadata: {
        command: "bun test packages/opencode --timeout 30000",
        description: "Run the opencode test suite",
        claudeTool: "Bash",
      },
      always: ["bun"],
    },
    {
      id: "perm_lab_edit",
      sessionID: "ses_lab",
      permission: "edit",
      patterns: ["src/server/auth.ts"],
      metadata: {
        filepath: "src/server/auth.ts",
        diff: MOCK_DIFF,
        claudeTool: "Edit",
      },
      always: ["src/server/auth.ts"],
    },
    {
      id: "perm_lab_webfetch",
      sessionID: "ses_lab",
      permission: "webfetch",
      patterns: ["docs.anthropic.com"],
      metadata: {
        url: "https://docs.anthropic.com/en/docs/agent-sdk",
        claudeTool: "WebFetch",
      },
      always: ["docs.anthropic.com"],
    },
  ] as unknown as PermissionRequest[]
}

function mockQuestions(): QuestionRequest[] {
  return [
    {
      id: "qst_lab_plan",
      sessionID: "ses_lab",
      questions: [
        {
          question: "Which authentication approach should the new API use?",
          header: "Auth method",
          options: [
            { label: "OAuth 2.0", description: "Redirect-based flow with refresh tokens. More setup, best UX." },
            { label: "API keys", description: "Static secrets per client. Simple, but rotation is manual." },
            { label: "Sessions", description: "Cookie-backed server sessions. Ties clients to sticky state." },
          ],
          multiple: false,
          custom: true,
        },
        {
          question: "Which environments should the rollout cover first?",
          header: "Rollout",
          options: [
            { label: "Staging", description: "Deploy behind the staging gateway." },
            { label: "Internal dogfood", description: "Ship to the internal workspace only." },
            { label: "Production", description: "Full rollout with feature flag." },
          ],
          multiple: true,
          custom: true,
        },
      ],
    },
  ] as unknown as QuestionRequest[]
}

function SafetyStage(props: { permissions: () => PermissionRequest[]; questions: () => QuestionRequest[] }) {
  const toast = useToast()
  const [permissions, setPermissions] = createSignal(props.permissions())
  const [questions, setQuestions] = createSignal(props.questions())

  const replyPermission = (request: PermissionRequest, reply: "once" | "always" | "reject") => {
    setPermissions((current) => current.filter((item) => item.id !== request.id))
    toast.push({ title: `Permission ${reply === "reject" ? "rejected" : "allowed"}`, detail: `${request.permission} - reply "${reply}"` })
  }
  const replyQuestion = (request: QuestionRequest, answers: QuestionAnswer[]) => {
    setQuestions((current) => current.filter((item) => item.id !== request.id))
    toast.push({ title: "Question answered", detail: answers.map((answer, index) => `Q${index + 1}: ${answer.join(", ")}`).join(" | ") })
  }
  const rejectQuestion = (request: QuestionRequest) => {
    setQuestions((current) => current.filter((item) => item.id !== request.id))
    toast.push({ title: "Question dismissed", tone: "warning" })
  }

  const empty = () => permissions().length === 0 && questions().length === 0

  return (
    <div class={styles.safetyStage}>
      <div class={styles.safetyStageTranscript} aria-hidden="true">
        <p><strong>You</strong> - Add refresh-token support to the auth service.</p>
        <p><strong>Assistant</strong> - I'll extend createSession to mint a refresh token and audit the event. Before I run the tests and edit the file, a few approvals are needed.</p>
      </div>
      <div class="session-dock-anchor">
        <Show
          when={!empty()}
          fallback={
            <div class={styles.safetyStageEmpty}>
              <p>Queue cleared.</p>
              <Button
                appearance="outline"
                onClick={() => {
                  setPermissions(props.permissions())
                  setQuestions(props.questions())
                }}
              >
                Reset requests
              </Button>
            </div>
          }
        >
          <SessionSafetyDock
            permissions={permissions()}
            questions={questions()}
            messages={[]}
            replyPermission={replyPermission}
            replyQuestion={replyQuestion}
            rejectQuestion={rejectQuestion}
          />
        </Show>
        <div class={styles.safetyStageComposer} aria-hidden="true">
          <span>Reply to Claude...</span>
        </div>
      </div>
    </div>
  )
}

export function LabSafety() {
  return (
    <>
      <Section
        title="Permissions only"
        detail="Three queued approvals: a shell command, an edit with its diff (Expand opens the full review), and a web fetch with the URL in the body. The pill reads 1 of 3. Keyboard: 1 allow once, 2 always allow, 3 reject, F expand, arrows page."
      >
        <SafetyStage permissions={mockPermissions} questions={() => []} />
      </Section>

      <Section
        title="Questions only"
        detail="One request with two questions: a single-select (auto-advances on choice) and a multi-select. Each question is a pill step; selections persist while paging and Reply submits once everything is answered."
      >
        <SafetyStage permissions={() => []} questions={mockQuestions} />
      </Section>

      <Section
        title="Combined queue"
        detail="Permissions come first, then questions. The pill reads group-relative - 1 of 3 with +2 questions hinted, and once the approvals are done, 1 of 2 with the questions."
      >
        <SafetyStage permissions={mockPermissions} questions={mockQuestions} />
      </Section>
    </>
  )
}
