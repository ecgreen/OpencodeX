import type { Part } from "@opencode-ai/sdk/v2/client"
import { MarkedProvider } from "@opencode-ai/ui/context/marked"
import { For } from "solid-js"
import type { MessageBundle } from "../../lib/session-api"
import { DisplayPartView, groupTranscriptParts } from "../session-transcript"
import { TranscriptChromeProvider } from "../session-part-chrome"
import { Section } from "./lab-shared"
import styles from "./lab.module.css"

/**
 * Real transcript parts rendered inside a hard 400px column, so narrow-width
 * containment can be verified by eye and by measuring the stage's scrollWidth.
 * Nothing here may cause horizontal scroll: long lines either wrap or scroll
 * inside their own box.
 */

const LONG_PATH = "packages/gui/src/renderer/src/components/session-transcript-panel-with-a-very-long-name.tsx"
const LONG_URL = "https://docs.anthropic.com/en/docs/agent-sdk/streaming-input-mode#handling-partial-message-chunks-and-reconnect"

const GREP_OUTPUT = [
  `${LONG_PATH}:123:  const compensator = createTranscriptViewportCompensator({ viewport, followBottom, suspended })`,
  `${LONG_PATH}:456:  const decision = transcriptLoadingSkeletonDecision({ loading, visible, forceBottomScroll, hasContent })`,
  "packages/opencode/src/opencodex/claude-driver.ts:88:      const permissionAgent = yield* agents.defaultInfo()",
].join("\n")

const LONG_DIFF = [
  "--- a/src/server/session-service.ts",
  "+++ b/src/server/session-service.ts",
  "@@ -10,4 +10,4 @@",
  " export function createSession(user: User) {",
  '-  const token = sign({ sub: user.id, workspace: user.workspaceID, role: user.role }, SECRET, { expiresIn: "7d", audience: "opencodex-desktop-client", issuer: "opencodex-session-service" })',
  '+  const token = sign({ sub: user.id, workspace: user.workspaceID, role: user.role, refresh: true }, SECRET, { expiresIn: "30d", audience: "opencodex-desktop-client", issuer: "opencodex-session-service" })',
  "   return { token }",
  " }",
].join("\n")

const MARKDOWN_TEXT = [
  "The failing case traces back to `createTranscriptViewportCompensator` - see the docs at",
  LONG_URL,
  "",
  "```ts",
  "const veryLongVariableName = transcriptLoadingSkeletonDecision({ loading: true, visible: false, forceBottomScroll: true, hasContent: false })",
  "```",
].join("\n")

let partID = 0
function toolPart(tool: string, input: Record<string, unknown>, output: string, metadata: Record<string, unknown> = {}): Part {
  partID += 1
  return {
    id: `prt_lab_${partID}`,
    sessionID: "ses_lab",
    messageID: "msg_lab",
    type: "tool",
    callID: `call_${partID}`,
    tool,
    state: {
      status: "completed",
      input,
      output,
      title: tool,
      metadata,
      time: { start: 1_000, end: 6_000 },
    },
  } as unknown as Part
}

function textPart(text: string): Part {
  partID += 1
  return {
    id: `prt_lab_${partID}`,
    sessionID: "ses_lab",
    messageID: "msg_lab",
    type: "text",
    text,
    time: { start: 1_000, end: 2_000 },
  } as unknown as Part
}

function specimenParts(): { label: string; parts: MessageBundle["parts"] }[] {
  return [
    {
      label: "shell command + output",
      parts: [
        toolPart(
          "bash",
          {
            command: "Get-ChildItem -Recurse -Filter *.tsx | Select-String -Pattern 'createTranscriptViewportCompensator' | Measure-Object -Line",
            description: "Count matches across renderer components",
          },
          "Lines Words Characters Property\n----- ----- ---------- --------\n   42",
        ),
      ],
    },
    {
      label: "grep with long matches",
      parts: [toolPart("grep", { pattern: "transcriptLoadingSkeletonDecision", path: "packages/gui" }, GREP_OUTPUT)],
    },
    {
      label: "edit diff with long lines",
      parts: [toolPart("edit", { filePath: "src/server/session-service.ts" }, "Edited file.", { diff: LONG_DIFF })],
    },
    {
      label: "markdown with code + long URL",
      parts: [textPart(MARKDOWN_TEXT)],
    },
    {
      label: "webfetch output",
      parts: [toolPart("webfetch", { url: LONG_URL }, `Fetched 128kb from ${LONG_URL} in 640ms. Content-Type: text/html; charset=utf-8`)],
    },
  ]
}

export function LabTranscript() {
  const chrome = { following: () => false, disclosure: () => undefined, live: () => false }
  return (
    <Section
      title="Transcript at 400px"
      detail="Every specimen renders the real transcript part components inside a hard 400px column. If this page ever scrolls horizontally, containment regressed. Expand rows to check their detail bodies too."
    >
      <MarkedProvider>
      <TranscriptChromeProvider value={chrome}>
        <div class={styles.transcriptStageRow}>
          <For each={specimenParts()}>
            {(specimen) => (
              <div class={styles.transcriptStage} data-lab-transcript-stage>
                <code class={styles.specimenLabel}>{specimen.label}</code>
                {/* The exact production chain: the scroll container users see a
                    horizontal bar on is section.transcript. */}
                <div class="transcript-shell">
                  <section class="transcript" data-lab-transcript-viewport>
                    <div class="transcript-content">
                      <article class="message assistant">
                        <For each={groupTranscriptParts(specimen.parts)}>
                          {(item) => (
                            <DisplayPartView
                              item={item}
                              showThinking={true}
                              showToolDetails={true}
                              showGenericToolOutput={true}
                              messageCompleted={true}
                            />
                          )}
                        </For>
                      </article>
                    </div>
                  </section>
                </div>
              </div>
            )}
          </For>
        </div>
      </TranscriptChromeProvider>
      </MarkedProvider>
    </Section>
  )
}
