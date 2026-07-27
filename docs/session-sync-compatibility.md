# Legacy session-sync compatibility

`GET /experimental/opencodex/session-sync` is deprecated as of OpencodeX `0.0.1`.

Neither the GUI nor the TUI calls this endpoint. First-party clients use:

- `GET /experimental/opencodex/state` for catalog and operations snapshots;
- `GET /experimental/opencodex/state/event` for replayable invalidations and reset handling;
- `GET /experimental/opencodex/state/session/:sessionID` for lazy transcript hydration and older pages.

The legacy endpoint remains available for the `0.0.1` compatibility window so external local integrations can migrate. Its JavaScript helper is quarantined in `@opencode-ai/sdk/v2/legacy-session-sync`; new code must not import that module.

Removal is scheduled for `0.0.2` or later. Before removal, the release notes must repeat the replacement endpoints and the repository quality gate must prove that no first-party source imports the legacy helper or requests the legacy route.
