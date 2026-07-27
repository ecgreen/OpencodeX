# GitHub repository and agent setup

Repository-owned configuration is under `.github`; the product GitHub Action is under `github`.

After this branch reaches `main`, configure GitHub to require pull requests and the consolidated `CI` checks, disallow force pushes/deletions, allow squash merges with conventional titles, and delete merged branches. Repository settings are intentionally not changed by CI because they require owner/admin authority.

The supported agent install command is `opencodex github install`. It writes `.github/workflows/opencodex.yml`, offers to migrate a legacy `opencode.yml`, uses `ecgreen/OpencodeX/github@v1`, installs an OpencodeX release, and executes `opencodex github run`. Direct `GITHUB_TOKEN` mode is the default; custom GitHub App/OIDC exchange remains optional for deployments that own such an endpoint.

GitHub notification email is a user-level setting. The repository reduces redundant mail by running CI only for pull requests and pushes to `main`, consolidating checks, cancelling superseded PR runs, and updating a single upstream-tracking issue only when its release marker changes.
