import { createSignal } from "solid-js"
import { Button, Dialog, IconButton, TextField, Tooltip } from "../ui"
import { Grid, Row, Section, Specimen } from "./lab-shared"
import styles from "./lab.module.css"

type DialogSize = "sm" | "md" | "lg" | "full"

export function LabOverlays() {
  const [size, setSize] = createSignal<DialogSize | undefined>()
  const [confirm, setConfirm] = createSignal(false)
  const [form, setForm] = createSignal(false)
  const [branch, setBranch] = createSignal("feature/design-system")

  return (
    <>
      <Section title="Tooltips" detail="The only tooltip surface. Never use the native title attribute on a control.">
        <Grid columns={3}>
          <Specimen label="label only">
            <Tooltip label="Restart the runner"><Button appearance="outline">Hover me</Button></Tooltip>
          </Specimen>
          <Specimen label="with shortcut">
            <Tooltip label="Open command palette" shortcut="mod+k"><Button appearance="outline">Palette</Button></Tooltip>
          </Specimen>
          <Specimen label="on an icon button">
            <IconButton appearance="ghost" icon="refresh" label="Resync session" tooltip="Resync session" shortcut="mod+r" />
            <IconButton appearance="ghost" icon="trash" label="Delete session" tooltip="Delete session" />
          </Specimen>
        </Grid>
      </Section>

      <Section title="Dialogs" detail="One modal surface owns the scrim, focus trap, focus restoration, and Escape.">
        <Row>
          <Button appearance="outline" onClick={() => setSize("sm")}>Small</Button>
          <Button appearance="outline" onClick={() => setSize("md")}>Medium</Button>
          <Button appearance="outline" onClick={() => setSize("lg")}>Large</Button>
          <Button appearance="outline" onClick={() => setSize("full")}>Full</Button>
          <Button appearance="soft" tone="danger" onClick={() => setConfirm(true)}>Destructive confirm</Button>
          <Button appearance="solid" tone="accent" onClick={() => setForm(true)}>Form dialog</Button>
        </Row>

        <Dialog
          open={size() !== undefined}
          onClose={() => setSize(undefined)}
          size={size()}
          title={`${size() ?? ""} dialog`}
          description="Tab cycles inside the dialog. Escape closes it and focus returns to the trigger."
          footer={
            <>
              <Button appearance="ghost" onClick={() => setSize(undefined)}>Cancel</Button>
              <Button appearance="solid" tone="accent" onClick={() => setSize(undefined)}>Confirm</Button>
            </>
          }
        >
          <p style={{ margin: 0, color: "var(--ds-text-muted)", "font-size": "var(--ds-text-md)", "line-height": "var(--ds-leading-prose)" }}>
            Dialog bodies scroll independently while the header and footer stay put, so long content never pushes the
            actions off screen.
          </p>
        </Dialog>

        <Dialog
          open={confirm()}
          onClose={() => setConfirm(false)}
          size="sm"
          dismissible={false}
          title="Discard 12 uncommitted changes?"
          description="This cannot be undone. The worktree will be reset to HEAD."
          footer={
            <>
              <Button appearance="ghost" onClick={() => setConfirm(false)}>Keep changes</Button>
              <Button appearance="solid" tone="danger" onClick={() => setConfirm(false)}>Discard</Button>
            </>
          }
        >
          <p style={{ margin: 0, color: "var(--ds-text-muted)", "font-size": "var(--ds-text-md)" }}>
            Destructive confirms are not dismissible: the scrim and Escape are disabled so the decision is explicit.
          </p>
        </Dialog>

        <Dialog
          open={form()}
          onClose={() => setForm(false)}
          size="md"
          title="Create branch"
          onSubmit={() => setForm(false)}
          footer={
            <>
              <Button appearance="ghost" type="button" onClick={() => setForm(false)}>Cancel</Button>
              <Button appearance="solid" tone="accent" type="submit">Create branch</Button>
            </>
          }
        >
          <TextField
            label="Branch name"
            technical
            value={branch()}
            onInput={(event) => setBranch(event.currentTarget.value)}
            description="Enter submits the form."
          />
        </Dialog>
      </Section>

      <Section title="Elevation in context" detail="Only detached surfaces carry shadow. Attached panels separate by tone.">
        <Grid columns={2}>
          <div class={styles.panel}>
            <strong style={{ "font-size": "var(--ds-text-base)" }}>Attached panel</strong>
            <p style={{ margin: "var(--ds-space-1) 0 0", color: "var(--ds-text-muted)", "font-size": "var(--ds-text-sm)" }}>
              Hairline border and one tonal step. No shadow.
            </p>
          </div>
          <div class={styles.panel} style={{ "box-shadow": "var(--ds-elevation-overlay)", background: "var(--ds-surface-raised)" }}>
            <strong style={{ "font-size": "var(--ds-text-base)" }}>Detached overlay</strong>
            <p style={{ margin: "var(--ds-space-1) 0 0", color: "var(--ds-text-muted)", "font-size": "var(--ds-text-sm)" }}>
              Menus, popovers, and tooltips sit above the page and cast a shadow.
            </p>
          </div>
        </Grid>
      </Section>
    </>
  )
}
