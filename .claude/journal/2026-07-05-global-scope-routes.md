# global-scope user-scoped routes — channels + schedules (2026-07-05)

Finish-everything pass, task #8. Closes Chad's headline note at the API level: GLOBAL (null-workspace)
and cross-workspace channels/schedules are now creatable, listable, and fully manageable via the API.
Chad's chosen shape: **user-scoped alongside** (keep the workspace-scoped routes; add user-scoped ones).

## What landed
New user-scoped route groups at the root (like `/approvals`), `...userScoped`:
- **`/channels`** → `channelsUser.*` (10 SDK methods): list (x-mcp `list_my_channels`), connect
  (`{scope,workspaceId?}` discriminated-union → 400 if workspace scope w/o id), get, disconnect, enable,
  disable, listAllowedSenders, addAllowedSender, removeAllowedSender, history.
- **`/schedules`** → `schedulesUser.*` (7): list (x-mcp `list_my_schedules`), create (`{scope,...}`, both
  fireAt+cron), update, enable, disable, delete, listRuns.
Distinct `channelsUser`/`schedulesUser` SDK namespaces → zero collision with the workspace-scoped `*`.

## New core ops (userId-scoped — TENANT SAFETY is the point)
- channels: `getChannelForUserOrThrow(db, channelId, userId)` (404 if missing OR not owned) + thin
  user-ops (`set-channel-enabled-for-user`, `disconnect-channel-for-user`, `{add,remove,list}-allowed-
  sender(s)-for-user`, `list-channel-history-for-user`) that authorize by userId then act. Extracted
  `build-new-allowed-sender-row` (shared by the ws + user add-sender; behavior-neutral).
- schedules: `listSchedulesForUser(db,{userId})` (repo + query op). Existing id-ops already authorize by
  userId (never touched workspaceId) → serve global schedules directly.

## Verification
- **Tenant-isolation test** (required, present): user B cannot list/get/patch/delete/enable user A's
  channel or schedule → 404; B's list excludes A's. Plus global create+list for both, and the "remind me
  in 20 min" one-time global schedule (fireAt, scope:global).
- Full gate `pnpm test` **1494 passed / 4 skip** (green on the COMBINED tree — see coordination note).
  typecheck 59/59; parity schema 30 / mcp / sdk; api:generate 45 paths / 54 SDK / 16 MCP tools (+2 read).

## ⚠ COORDINATION — parallel UI work in the tree
Chad has an uncommitted **desktop UI milestone** in the working tree (`apps/local-web/`, `packages/ui/`
= `@vynel/ui`, `.claude/journal/2026-07-05-desktop-ui-m1.md`, `docs/module-notes/desktop-ui.md`, + config:
vue-demi allowBuilds, vitest.workspace web project, eslint, .gitignore). **I committed ONLY my backend
files (explicit staging), left all his UI + shared-config changes UNSTAGED.** Future commits in this pass
must keep staging explicitly (no `git add -A`) until his UI work is committed. His `local-web` tests are
green in the combined gate.

## Phase-2 flag
User-scoped create with `scope:'workspace'` trusts the body `workspaceId` without an owner-check on the
workspace (the row is still caller-owned; moot in Phase-1 single-user). Add the check when multi-user lands.
