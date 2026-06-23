import { StatusBadge } from "./ui"

export function StatusPill(props: { status: string }) {
  return <StatusBadge class={`status ${props.status.replaceAll("_", "-").replaceAll(" ", "-")}`} status={props.status} />
}
