# OpencodeX GitHub Action

This action runs the OpencodeX GitHub agent for issue comments and pull-request review comments while preserving the local provider, MCP, plugin, session, and SDK contracts.

## Install

Run `opencodex github install` in a GitHub repository. It creates `.github/workflows/opencodex.yml` using the versioned action:

```yaml
- name: Run OpencodeX
  uses: ecgreen/OpencodeX/github@v1
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
  with:
    model: anthropic/claude-sonnet-4-5
    use_github_token: true
```

If `.github/workflows/opencode.yml` exists, the installer asks before migrating it rather than creating a duplicate workflow.

The action downloads the matching OpencodeX release from `ecgreen/OpencodeX`, caches it under `~/.opencodex/bin`, and executes `opencodex github run`. Use `opencodex/…` branches for agent-created work.

Report problems in the [OpencodeX issue tracker](https://github.com/ecgreen/OpencodeX/issues).
