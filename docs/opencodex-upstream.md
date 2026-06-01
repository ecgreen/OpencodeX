# OpencodeX Upstream Touchpoints

OpencodeX project support is intentionally implemented as an additive overlay so upstream `dev` can be merged with fewer conflicts.

## Core Overlay

- `packages/core/src/opencodex/sql.ts` adds sidecar tables for OpencodeX projects, configured folders, and OpencodeX-owned sessions while keeping each OpencodeX project linked to upstream `project.id`.
- `packages/core/src/database/migration/*opencodex*` creates and repairs those sidecar tables without changing upstream schemas.
- `packages/opencode/src/opencodex/project-folder.ts` owns folder normalization, CRUD, and longest-prefix matching.
- `packages/opencode/src/opencodex/project.ts` composes upstream project/session services for OpencodeX projects, optional folder validation, session membership/move/delete, and namespaced session creation.
- `packages/opencode/src/server/routes/instance/httpapi/groups/opencodex.ts` and `handlers/opencodex.ts` expose `/experimental/opencodex/*` routes.

## Upstream Seams

- `packages/opencode/src/server/routes/instance/httpapi/api.ts` registers the OpencodeX API group.
- `packages/opencode/src/server/routes/instance/httpapi/server.ts` registers the OpencodeX handlers and service layer.
- `packages/opencode/src/project/project.ts` checks sidecar folder matches before deriving a new upstream project id, so sessions created in any configured folder map to the user-managed project.
- `packages/opencode/src/project/instance-store.ts` carries configured OpencodeX folders into `InstanceContext`.
- `packages/opencode/src/project/instance-context.ts` treats configured folders as trusted roots for file/shell boundary checks.
- `packages/opencode/src/session/system.ts` injects the active folder and configured project folders into model environment context.
- `packages/opencode/src/session/session.ts` adds an optional `projectID` filter for global session listing.
- `packages/opencode/src/cli/cmd/tui/context/sdk.tsx` exposes an authenticated raw request helper for namespaced overlay routes.
- `packages/opencode/src/cli/cmd/tui/component/opencodex-sidebar.tsx` mounts the project/session sidebar without reshaping upstream session data.

## After Upstream Merges

Run:

```sh
git diff dev...HEAD -- packages/opencode/src
cd packages/opencode && bun typecheck
cd packages/opencode && bun test test/opencodex
./packages/sdk/js/script/build.ts
```
