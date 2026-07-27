import type { CodeEditorNavigation } from "./code-editor"
import type { CodeEditorHover } from "./code-editor-hover"
import type { CodeEditorCompletionLoad } from "./code-editor-completion"
import { LazyCodeEditor } from "./lazy-code-editor"
import type { OpenTab } from "./session-side-open-types"
import type { createWorkbenchDiagnosticsController } from "./workbench-diagnostics-controller"
import { WorkbenchDiagnosticsBar } from "./workbench-diagnostics"

export function SessionSideFileEditor(props: {
  tab?: OpenTab
  diagnostics: ReturnType<typeof createWorkbenchDiagnosticsController>
  navigation?: CodeEditorNavigation
  change: (value: string) => void
  save: () => void
  definition: (position: { line: number; column: number }) => void
  hover: (position: { line: number; column: number }, signal?: AbortSignal) => Promise<CodeEditorHover | undefined>
  completion: CodeEditorCompletionLoad
}) {
  return (
    <>
      <LazyCodeEditor
        path={props.tab?.path ?? ""}
        value={props.tab?.text ?? ""}
        original={props.tab?.original ?? ""}
        diagnostics={props.diagnostics.active()}
        navigation={props.navigation}
        onChange={props.change}
        onSave={props.save}
        onDefinition={props.definition}
        onHover={props.hover}
        onCompletion={props.completion}
        readOnly={props.tab?.readOnly === true}
      />
      <WorkbenchDiagnosticsBar
        loading={props.diagnostics.loading()}
        supported={props.diagnostics.supported()}
        message={props.diagnostics.message()}
        total={props.diagnostics.diagnostics().length}
        onRun={() => void props.diagnostics.refresh()}
      />
    </>
  )
}
