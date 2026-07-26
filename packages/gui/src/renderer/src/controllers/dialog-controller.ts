import { createSignal } from "solid-js"
import type { ChoiceOption, DialogState, ProjectDialogValue } from "../components/dialog-modal"
import type { GuiTranscriptExportOptions } from "../lib/transcript-export"

export function createDialogController() {
  const [dialog, setDialog] = createSignal<DialogState>()

  return {
    dialog,
    close: () => setDialog(undefined),
    askText: (input: { title: string; message?: string; value?: string; multiline?: boolean }) =>
      new Promise<string | undefined>((resolve) => setDialog({ type: "text", ...input, resolve })),
    askProject: (input: { title: string; message?: string; name: string; folders: string[] }) =>
      new Promise<ProjectDialogValue | undefined>((resolve) => setDialog({ type: "project", ...input, resolve })),
    confirm: (input: { title: string; message: string; confirm?: string; scope?: string }) =>
      new Promise<boolean>((resolve) => setDialog({ type: "confirm", ...input, resolve })),
    askChoice: (input: { title: string; message?: string; options: ChoiceOption[] }) =>
      new Promise<string | undefined>((resolve) => setDialog({ type: "choice", ...input, resolve })),
    askExportOptions: (input: { title: string; message?: string; defaults: GuiTranscriptExportOptions }) =>
      new Promise<GuiTranscriptExportOptions | undefined>((resolve) =>
        setDialog({ type: "export", ...input, resolve }),
      ),
  }
}
