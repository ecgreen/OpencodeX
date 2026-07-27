export const swarmRouteBindingCommands = [
  "opencodex.swarm.route.up",
  "opencodex.swarm.route.down",
  "opencodex.swarm.route.open",
  "opencodex.swarm.route.create",
  "opencodex.swarm.route.dashboard",
  "opencodex.swarm.route.refresh",
] as const

export const swarmNavigationRouteBindingCommands = [
  ...swarmRouteBindingCommands,
  "opencodex.swarm.route.left",
  "opencodex.swarm.route.right",
] as const

export const swarmRunPlaceholder = {
  normal: [
    "Assign a task to implement the next feature",
    "Assign a task to investigate a regression",
    "Assign a task to review the current plan",
  ],
  shell: ["git status", "pwd", "rg TODO"],
}
