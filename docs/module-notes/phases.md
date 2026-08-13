# Phases — module notes

**Status:** requested by Kafi 2026-08-11 ("phases are engineering plan… like plan package but it
will hold big description") · net-new leaf, *built* (not pulled) on the Plans template, together
with Features.
**Arc:** Phases + Features, the engineering-plan layer, exposed through MCP.

## Kafi's calls (the why)

- Phases are the **engineering build plan** — how the workspace's app gets built, stage by stage.
- **Ordered + status** (Kafi picked the recommended shape): each phase has an `orderIndex`
  (Phase 1, 2, 3…), a title, a **big description** (the full write-up, up to 50k chars), and the
  shared open / in-progress / done status vocabulary.
- Exposed through MCP so the assistant maintains the build plan itself.

## Shape

Leaf `packages/phases` (`@vynel/phases`), template `packages/plans` in structure. Key deviations
from plans, all deliberate:

- **Workspace-scoped NOT NULL** (the `workspace_apps` narrowing): an engineering plan describes
  ONE project's build — no global phases, and no user-scoped twin routes.
- **`description` is big-form and required** (≤50k) — the phase IS its write-up. Because of the
  size, the LIST surfaces (route + `list_phases` MCP tool) return a bounded
  `descriptionPreview` (240 chars, `routes/_shared/description-preview.ts`); the full text lives
  on `GET /:phaseId` / `get_phase`. Two response shapes in
  `@vynel/contracts/phases/phase-http`.
- **`orderIndex`**: creates append (`max + 1` computed INSIDE the create transaction);
  `update_phase` moves a phase explicitly. No fractional reordering scheme until someone needs
  one.
- **No `source` column**: phases have no user-facing create door yet (MCP-only surface), so
  provenance is single-valued — add the column the day a user door lands.
- **delete IS agent-exposed** (unlike plans): with no UI surface, reshaping the plan must be
  possible from chat. `delete_phase` rides the ask-mode approval tier automatically (DELETE
  method → `generatedAskModeApprovalToolNames`).
- Capability `phases` (defaultEnabled, workspace scope) gates all six tools + the prompt
  section, exactly like `plans`.

Routes `/workspaces/:workspaceId/phases` (list/create/get/update/complete/delete, all x-mcp);
migration `0034_phases_features` (shared with features — one arc, one commit).

## Deferred / follow-ups

- UI section (a Phases menu like Plans) — not requested; MCP-only for now.
- `source` column + user create door — with the UI, if it comes.
