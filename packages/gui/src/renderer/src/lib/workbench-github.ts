export function workbenchGithubLinks(input: {
  githubUrl?: string
  branch?: string
  defaultBranch?: string
}) {
  const repository = normalizedGithubUrl(input.githubUrl)
  if (!repository) return
  const branch = input.branch?.trim()
  const base = input.defaultBranch?.trim() || "main"
  const compare = branch && branch !== base
    ? `${repository}/compare/${encodeURIComponent(base)}...${encodeURIComponent(branch)}?quick_pull=1`
    : `${repository}/compare`
  return {
    repository,
    pulls: `${repository}/pulls`,
    issues: `${repository}/issues`,
    actions: `${repository}/actions`,
    compare,
    newIssue: `${repository}/issues/new/choose`,
  }
}

export function workbenchPullNumber(value: string) {
  const match = /^#?(\d+)$/.exec(value.trim())
  if (!match) return
  const number = Number(match[1])
  return Number.isSafeInteger(number) && number > 0 ? number : undefined
}

export function workbenchGithubPullLink(input: { githubUrl?: string; number?: number }) {
  const repository = normalizedGithubUrl(input.githubUrl)
  if (!repository || !input.number) return
  return `${repository}/pull/${input.number}`
}

function normalizedGithubUrl(value: string | undefined) {
  if (!value) return
  const url = value.replace(/\/+$/, "")
  try {
    const parsed = new URL(url)
    if (parsed.hostname !== "github.com") return
    const path = parsed.pathname.replace(/\.git$/, "").replace(/^\/+|\/+$/g, "")
    if (path.split("/").length !== 2) return
    return `https://github.com/${path}`
  } catch {
    return
  }
}
