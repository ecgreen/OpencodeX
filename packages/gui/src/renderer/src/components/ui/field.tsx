import type { JSX } from "solid-js"
import { Show, createUniqueId, splitProps } from "solid-js"
import { Icon } from "../icon"
import { IconButton } from "./button"
import { classes, type ControlSize } from "./shared"

type FieldShellProps = {
  label?: JSX.Element
  description?: JSX.Element
  error?: JSX.Element
  required?: boolean
  loading?: boolean
  class?: string
  children: JSX.Element
  controlId: string
}

function FieldShell(props: FieldShellProps) {
  return (
    <div data-ui="field" data-invalid={props.error ? "true" : undefined} data-loading={props.loading ? "true" : undefined} class={props.class}>
      <Show when={props.label}>
        <label class="ui-field-label" for={props.controlId}>{props.label}<Show when={props.required}><span aria-hidden="true"> *</span></Show></label>
      </Show>
      {props.children}
      <div class="ui-field-message" aria-live="polite">
        <Show when={props.error} fallback={<span>{props.description}</span>}><span role="alert">{props.error}</span></Show>
      </div>
    </div>
  )
}

export type TextFieldProps = Omit<JSX.InputHTMLAttributes<HTMLInputElement>, "size" | "prefix"> & {
  label?: JSX.Element
  description?: JSX.Element
  error?: JSX.Element
  prefix?: JSX.Element
  suffix?: JSX.Element
  size?: ControlSize
  technical?: boolean
  loading?: boolean
  clearable?: boolean
  onClear?: () => void
  fieldClass?: string
}

export type InputProps = Omit<JSX.InputHTMLAttributes<HTMLInputElement>, "size"> & {
  size?: ControlSize
  technical?: boolean
  invalid?: boolean
}

export function Input(props: InputProps) {
  const [local, rest] = splitProps(props, ["size", "technical", "invalid", "class", "classList"])
  return (
    <input
      {...rest}
      data-ui="input"
      data-size={local.size ?? "default"}
      data-technical={local.technical ? "true" : undefined}
      aria-invalid={local.invalid || rest["aria-invalid"] ? "true" : undefined}
      class={classes("ui-input", local.class)}
      classList={local.classList}
    />
  )
}

export function TextField(props: TextFieldProps) {
  const [local, rest] = splitProps(props, [
    "label", "description", "error", "prefix", "suffix", "size", "technical", "loading", "clearable", "onClear",
    "fieldClass", "class", "classList", "id", "required", "disabled", "readOnly",
  ])
  const generatedId = createUniqueId()
  const id = () => local.id ?? `gui-field-${generatedId}`
  return (
    <FieldShell label={local.label} description={local.description} error={local.error} required={local.required} loading={local.loading} class={local.fieldClass} controlId={id()}>
      <div class="ui-field-control" data-size={local.size ?? "default"} data-technical={local.technical ? "true" : undefined}>
        <Show when={local.prefix}><span class="ui-field-affix">{local.prefix}</span></Show>
        <Input
          {...rest}
          id={id()}
          required={local.required}
          disabled={local.disabled || local.loading}
          readOnly={local.readOnly}
          aria-invalid={local.error ? "true" : undefined}
          data-embedded="true"
          technical={local.technical}
          class={local.class}
          classList={local.classList}
        />
        <Show when={local.loading}><span class="ui-field-spinner" aria-hidden="true" /></Show>
        <Show when={local.clearable && !local.loading}><IconButton appearance="ghost" icon="x" label="Clear field" size="compact" onClick={local.onClear} /></Show>
        <Show when={local.suffix}><span class="ui-field-affix">{local.suffix}</span></Show>
      </div>
    </FieldShell>
  )
}

export function SearchField(props: Omit<TextFieldProps, "type" | "prefix">) {
  return <TextField {...props} type="search" prefix={<Icon name="search" />} />
}

export type TextAreaProps = JSX.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label?: JSX.Element
  description?: JSX.Element
  error?: JSX.Element
  technical?: boolean
  loading?: boolean
  fieldClass?: string
}

export type TextareaProps = JSX.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  technical?: boolean
  invalid?: boolean
}

export function Textarea(props: TextareaProps) {
  const [local, rest] = splitProps(props, ["technical", "invalid", "class", "classList"])
  return <textarea {...rest} data-ui="textarea" data-technical={local.technical ? "true" : undefined} aria-invalid={local.invalid || rest["aria-invalid"] ? "true" : undefined} class={classes("ui-textarea", local.class)} classList={local.classList} />
}

export function TextArea(props: TextAreaProps) {
  const [local, rest] = splitProps(props, ["label", "description", "error", "technical", "loading", "fieldClass", "class", "classList", "id", "required", "disabled"])
  const generatedId = createUniqueId()
  const id = () => local.id ?? `gui-field-${generatedId}`
  const hasFieldShell = () => local.label !== undefined || local.description !== undefined || local.error !== undefined || local.loading !== undefined || local.fieldClass !== undefined
  return (
    <Show
      when={hasFieldShell()}
      fallback={<Textarea {...rest} id={local.id} required={local.required} disabled={local.disabled} technical={local.technical} class={local.class} classList={local.classList} />}
    >
      <FieldShell label={local.label} description={local.description} error={local.error} required={local.required} loading={local.loading} class={local.fieldClass} controlId={id()}>
        <Textarea {...rest} id={id()} required={local.required} disabled={local.disabled || local.loading} invalid={Boolean(local.error)} technical={local.technical} class={local.class} classList={local.classList} />
      </FieldShell>
    </Show>
  )
}

export function TextInput(props: InputProps) {
  return <Input {...props} />
}

export type FieldProps = Omit<FieldShellProps, "controlId"> & { controlId?: string }

export function Field(props: FieldProps) {
  const generatedId = createUniqueId()
  return <FieldShell {...props} controlId={props.controlId ?? `gui-field-${generatedId}`} />
}
