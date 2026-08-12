import { createSignal } from "solid-js"
import type { PromptPart } from "../../lib/session-api"
import { SessionComposer } from "../session-composer"
import { useToast } from "../ui"
import { Grid, Section, Specimen } from "./lab-shared"
import styles from "./lab.module.css"

type QueuedPrompt = { id: string; text: string; input: string; hasAttachments: boolean }

const QUEUED = [
  { id: "queue-tests", text: "After this, run the focused regression tests.", input: "After this, run the focused regression tests.", hasAttachments: false },
  { id: "queue-docs", text: "Then update the release note with the new behavior.", input: "Then update the release note with the new behavior.", hasAttachments: false },
  { id: "queue-review", text: "Finally, review the resulting diff for regressions.", input: "Finally, review the resulting diff for regressions.", hasAttachments: false },
]

function ComposerStage(props: {
  running?: boolean
  blocked?: boolean
  disconnected?: boolean
  armed?: boolean
  draft?: string
  queued?: QueuedPrompt[]
  narrow?: boolean
}) {
  const toast = useToast()
  const [draft, setDraft] = createSignal(props.draft ?? "")
  const [parts, setParts] = createSignal<PromptPart[]>([])
  const [queued, setQueued] = createSignal(props.queued ?? [])
  const [mode, setMode] = createSignal<"plan" | "build" | "goal">("build")
  const submit = (event: SubmitEvent) => {
    event.preventDefault()
    if (!draft().trim() && parts().length === 0) return
    const delivery =
      event.submitter instanceof HTMLButtonElement && event.submitter.value === "queue" ? "queue" : "direct"
    if (delivery === "queue") {
      setQueued((current) => [...current, { id: `queue-${Date.now()}`, text: draft().trim() || "Attached context", input: draft().trim(), hasAttachments: parts().length > 0 }])
    }
    toast.push({
      title: delivery === "queue" ? "Message queued" : props.running ? "Conversation redirected" : "Message sent",
      detail: draft().trim() || "Attached context",
    })
    setDraft("")
    setParts([])
  }
  const noop = () => undefined

  return (
    <div class={styles.composerStage} data-narrow={props.narrow ? "true" : undefined}>
      <SessionComposer
        blocked={props.blocked === true}
        disconnectedProviderName={props.disconnected ? "Anthropic" : undefined}
        connectProvider={props.disconnected ? () => toast.push({ title: "Connect provider selected" }) : undefined}
        running={props.running === true}
        queuedPrompts={queued()}
        updateQueuedPrompt={(id, value) => setQueued((current) => current.map((item) => item.id === id ? { ...item, text: value || "Attached context", input: value } : item))}
        removeQueuedPrompt={(id) => setQueued((current) => current.filter((item) => item.id !== id))}
        mode={mode()}
        draftPrompt={draft()}
        draftParts={parts()}
        draftText={draft().trim()}
        slashMenuVisible={false}
        visibleSlashCommands={[]}
        selectedSlashCommand={0}
        mentionMenuVisible={false}
        mentionOptions={[]}
        abortConfirmArmed={props.armed === true}
        stashCount={0}
        variants={["low", "high"]}
        variantPickerOpen={false}
        selectedVariant="high"
        modelLabel="Claude Sonnet"
        variantLabel="High"
        usageLabel={props.running ? "18.4k tokens" : undefined}
        submit={submit}
        setTextarea={noop}
        setDraftPrompt={setDraft}
        setDraftParts={(update) => setParts(update)}
        setHistoryIndex={noop}
        setHistoryDraft={noop}
        setSlashMenuOpen={noop}
        setSelectedSlashCommand={noop}
        setModelPickerOpen={noop}
        setVariantPickerOpen={noop}
        runSlashCommand={noop}
        completeSlashCommand={noop}
        selectSlashCommand={noop}
        chooseMention={noop}
        stashPrompt={() => toast.push({ title: "Draft stashed" })}
        popStash={noop}
        pasteFiles={noop}
        addPickedContext={() => toast.push({ title: "Context picker selected" })}
        dropContext={noop}
        cycleVariant={noop}
        loadHistory={() => false}
        toggleMode={() => setMode((current) => (current === "build" ? "plan" : current === "plan" ? "goal" : "build"))}
        setMode={setMode}
        selectVariant={noop}
      />
    </div>
  )
}

export function LabComposer() {
  return (
    <>
      <Section
        title="Delivery states"
        detail="The production composer at normal desktop width. Enter queues while running; Ctrl+Enter interrupts and sends now. Buttons remain explicit for pointer and touch users."
      >
        <Grid columns={2}>
          <Specimen label="idle / standard send">
            <ComposerStage draft="Add a regression test for session delivery." />
          </Specimen>
          <Specimen label="running / empty draft / actions disabled">
            <ComposerStage running />
          </Specimen>
          <Specimen label="running / draft / queue and direct available">
            <ComposerStage running draft="Focus on the synchronization bug first." />
          </Specimen>
          <Specimen label="running / interruption armed">
            <ComposerStage running armed draft="Use the smaller implementation instead." />
          </Specimen>
          <Specimen label="running / one queued message">
            <ComposerStage running draft="This should redirect the active task." queued={QUEUED.slice(0, 1)} />
          </Specimen>
          <Specimen label="running / several queued messages">
            <ComposerStage running draft="Add one more queued follow-up." queued={QUEUED} />
          </Specimen>
          <Specimen label="running / provider disconnected">
            <ComposerStage running disconnected draft="This cannot be delivered yet." queued={QUEUED.slice(0, 1)} />
          </Specimen>
          <Specimen label="running / safety request blocks composer">
            <ComposerStage running blocked draft="Wait for the permission response." queued={QUEUED.slice(0, 2)} />
          </Specimen>
          <Specimen label="idle / queued messages draining">
            <ComposerStage draft="A new regular message." queued={QUEUED.slice(0, 2)} />
          </Specimen>
        </Grid>
      </Section>

      <Section
        title="Narrow session column"
        detail="A hard 360px stage covers split-view and compact-window pressure with active delivery choices and a three-item queue."
      >
        <Specimen label="360px / running / multiple queued" wide>
          <ComposerStage narrow running draft="Direct the session without overflowing this column." queued={QUEUED} />
        </Specimen>
      </Section>
    </>
  )
}
