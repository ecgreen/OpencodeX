export function StatusPill(props: { status: string }) {
  return <span class={`status ${props.status.replaceAll("_", "-").replaceAll(" ", "-")}`}>{props.status}</span>
}
