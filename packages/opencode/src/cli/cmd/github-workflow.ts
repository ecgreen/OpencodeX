export const WORKFLOW_FILE = ".github/workflows/opencodex.yml"
export const LEGACY_WORKFLOW_FILE = ".github/workflows/opencode.yml"

export function renderGithubWorkflow(provider: string, model: string, environment: readonly string[]) {
  const env =
    provider === "amazon-bedrock"
      ? ""
      : `\n        env:${environment.map((name) => `\n          ${name}: \${{ secrets.${name} }}`).join("")}`
  return `name: OpencodeX

on:
  issue_comment:
    types: [created]
  pull_request_review_comment:
    types: [created]

jobs:
  opencodex:
    if: |
      contains(github.event.comment.body, ' /oc') ||
      startsWith(github.event.comment.body, '/oc') ||
      contains(github.event.comment.body, ' /opencode') ||
      startsWith(github.event.comment.body, '/opencode')
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
      issues: write
    steps:
      - name: Checkout repository
        uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5
        with:
          persist-credentials: false

      - name: Run OpencodeX
        uses: ecgreen/OpencodeX/github@v1${env}
        with:
          model: ${provider}/${model}
          use_github_token: true
`
}
