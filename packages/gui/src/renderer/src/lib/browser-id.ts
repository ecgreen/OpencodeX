export function newBrowserID() {
  return `workbench-${Math.random().toString(36).slice(2)}`
}
