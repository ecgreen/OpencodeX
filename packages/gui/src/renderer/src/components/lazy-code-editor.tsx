import { Suspense, lazy } from "solid-js"
import type { CodeEditorProps } from "./code-editor"
import { LoadingState } from "./ui"

const CodeEditor = lazy(() => import("./code-editor").then((module) => ({ default: module.CodeEditor })))

export function LazyCodeEditor(props: CodeEditorProps) {
  return (
    <Suspense
      fallback={
        <div class="workbench-codemirror editor-loading">
          <LoadingState title="Loading editor" compact />
        </div>
      }
    >
      <CodeEditor {...props} />
    </Suspense>
  )
}
