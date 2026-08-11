# Features — module notes

**Status:** requested by Kafi 2026-08-11 ("Feature similar to phases will hold big description") ·
net-new leaf, *built* (not pulled) on the Phases/Plans template, together with Phases.
**Arc:** Phases + Features, the engineering-plan layer, exposed through MCP.

## Kafi's calls (the why)

- Features are the **catalog of what the app should have** — each a big-form write-up (up to 50k
  chars) of what the feature does and how it behaves.
- **Optional `phaseId` loose ref** (Kafi picked the recommended shape): a feature can point at
  the build-plan phase that delivers it — the `tasks.planId` precedent (sibling leaves, NO FK,
  a deleted phase leaves the id dangling harmlessly).
- Exposed through MCP so the assistant maintains the catalog.

## Shape

Leaf `packages/features` (`@vynel/features`), identical in structure to `packages/phases` minus
ordering:

- **Workspace-scoped NOT NULL**, big-form required `description` (≤50k), preview-in-list /
  full-text-in-get split (`@vynel/contracts/features/feature-http`), shared status vocabulary,
  `completedAt` stamp/clear rule, hard delete + outbox events — all as in phases.
- **No `orderIndex`** — the catalog is unordered (grouping comes from `phaseId`); list is
  `createdAt` asc, filterable by `status` and `phaseId`.
- `update_feature` accepts `phaseId: null` to unlink.
- Capability `features` (defaultEnabled, workspace scope) gates all six tools + the prompt
  section; `delete_feature` rides the ask-mode tier via its DELETE method.

Routes `/workspaces/:workspaceId/features` (list/create/get/update/complete/delete, all x-mcp);
migration `0034_phases_features` (shared with phases).

## Deferred / follow-ups

- UI section — not requested; MCP-only for now.
- If phases ever cascade-clean their features, that's an outbox subscriber's job, never a FK.
