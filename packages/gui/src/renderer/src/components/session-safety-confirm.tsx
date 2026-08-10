import { Button, Dialog, DialogFooter } from "./ui"

/**
 * One confirm surface for both safety card types: dismissing a question and
 * rejecting a permission are the same destructive gesture, so they share copy
 * shape, focus order (Cancel first), and Escape behavior via Dialog.
 */
export function SafetyDismissConfirm(props: {
  open: boolean
  title: string
  body: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Dialog
      open={props.open}
      onClose={props.onCancel}
      title={props.title}
      size="sm"
      class="safety-dismiss-confirm"
      footer={
        <DialogFooter align="end">
          <Button onClick={props.onCancel}>Cancel</Button>
          <Button appearance="solid" tone="danger" onClick={props.onConfirm}>{props.confirmLabel}</Button>
        </DialogFooter>
      }
    >
      <p class="safety-dismiss-body">{props.body}</p>
    </Dialog>
  )
}
