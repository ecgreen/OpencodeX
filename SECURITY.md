# Security

## IMPORTANT

We do not accept AI generated security reports. We receive a large number of
these and we absolutely do not have the resources to review them all. If you
submit one that will be an automatic ban from the project.

## Threat Model

### Overview

OpencodeX is an AI-powered coding assistant that runs locally on your machine. It provides an agent system with access to powerful tools including shell execution, file operations, and web access.

### No Sandbox

OpencodeX does **not** sandbox the agent. The permission system exists as a UX feature to help users stay aware of what actions the agent is taking - it prompts for confirmation before executing commands, writing files, etc. However, it is not designed to provide security isolation.

If you need true isolation, run OpencodeX inside a Docker container or VM.

### Desktop GUI Preview

The desktop GUI public preview launches a local OpencodeX sidecar coordinator over loopback with generated credentials. The GUI is a convenience shell around the same local backend and session store as the TUI; it is not an additional sandbox boundary.

Public GUI preview installers are expected to be signed on Windows and signed/notarized on macOS. Operating-system trust prompts, quarantine warnings, or SmartScreen warnings for an explicitly unsigned internal preview build are distribution limitations, not security vulnerabilities by themselves. Verify downloaded assets with the release checksums.

### Server Mode

Server mode is opt-in only. When enabled, set `OPENCODE_SERVER_PASSWORD` to require HTTP Basic Auth. Without this, the server runs unauthenticated (with a warning). It is the end user's responsibility to secure the server - any functionality it provides is not a vulnerability.

### Out of Scope

| Category                        | Rationale                                                               |
| ------------------------------- | ----------------------------------------------------------------------- |
| **Server access when opted-in** | If you enable server mode, API access is expected behavior              |
| **Sandbox escapes**             | The permission system is not a sandbox (see above)                      |
| **LLM provider data handling**  | Data sent to your configured LLM provider is governed by their policies |
| **MCP server behavior**         | External MCP servers you configure are outside our trust boundary       |
| **Malicious config files**      | Users control their own config; modifying it is not an attack vector    |

---

# Reporting Security Issues

We appreciate your efforts to responsibly disclose your findings, and will make every effort to acknowledge your contributions.

Report privately through GitHub, never in a public issue or pull request:

1. Go to <https://github.com/ecgreen/OpencodeX/security> (the repository's **Security** tab).
2. Choose **Report a vulnerability** — this opens a [GitHub private vulnerability report](https://github.com/ecgreen/OpencodeX/security/advisories/new) visible only to you and the maintainer.
3. Include the affected version (`opencodex --version`), your platform, and reproduction steps.

The maintainer will respond with the next steps in handling your report, and will keep you informed of progress towards a fix and disclosure. Additional information or guidance may be requested.

## Escalation

If you do not receive an acknowledgement within 6 business days, comment on your own private advisory to bump it. GitHub notifies the maintainer for every advisory update, so the private advisory thread is the escalation path — there is no separate security mailing address for this fork.

<!-- MAINTAINER NOTE: if you would rather receive reports directly, replace the escalation
     paragraph above with a private contact address you actually monitor. Do not list an
     address that forwards to the upstream project — reports sent there will not reach you. -->
