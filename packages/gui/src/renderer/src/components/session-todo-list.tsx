import { For, Show, createMemo } from "solid-js"
import { formatTodoStatus } from "../lib/tool-display"
import { Icon } from "./icon"

export type TodoItem = { content: string; status: string; priority?: string }

/**
 * One todo presentation for both the transcript and the inspector. Reads as a
 * plan: a progress bar up top, then a stepper rail connecting status markers,
 * with priority as a quiet chip instead of shouting uppercase text.
 */
export function TodoList(props: { todos: TodoItem[]; class?: string }) {
  const done = createMemo(() => props.todos.filter((todo) => todo.status === "completed").length)
  const percent = createMemo(() => props.todos.length === 0 ? 0 : Math.round((done() / props.todos.length) * 100))
  return (
    <Show when={props.todos.length > 0}>
      <div class="todo-list" classList={{ [props.class ?? ""]: Boolean(props.class) }}>
        <Show when={props.todos.length > 1}>
          <header class="todo-progress">
            <div
              class="todo-progress-track"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={props.todos.length}
              aria-valuenow={done()}
              aria-label={`${done()} of ${props.todos.length} todos done`}
            >
              <div class="todo-progress-fill" style={{ width: `${percent()}%` }} />
            </div>
            <span class="todo-progress-label">{done()} of {props.todos.length} done</span>
          </header>
        </Show>
        <ol class="todo-items">
          <For each={props.todos}>
            {(todo) => (
              <li class="todo-item" data-status={todo.status}>
                <span class="todo-marker" title={formatTodoStatus(todo.status)} aria-label={formatTodoStatus(todo.status)}>
                  <TodoMarkerGlyph status={todo.status} />
                </span>
                <span class="todo-content">{todo.content}</span>
                <Show when={todo.priority}>
                  {(priority) => <span class="todo-priority" data-priority={priority()}>{priority()}</span>}
                </Show>
              </li>
            )}
          </For>
        </ol>
      </div>
    </Show>
  )
}

function TodoMarkerGlyph(props: { status: string }) {
  return (
    <Show when={props.status !== "pending"}>
      <Show when={props.status === "in_progress"} fallback={<Icon name={props.status === "cancelled" ? "x" : "check"} />}>
        <span class="todo-marker-dot" aria-hidden="true" />
      </Show>
    </Show>
  )
}
