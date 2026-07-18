// A stable accent color per workspace, assigned by hashing its name — so a
// bubbled-up report row, its "Watch" chip, and the in-flight banner all wear
// the SAME color with no stored column and no name→id→color lookup.
//
// Why hash the name, not the id: a report row in the global thread carries only
// `sourceLabel`, never the workspaceId. Hashing a normalized name keeps every
// surface consistent — the banner (which has the bare `workspaceName`) and the
// row resolve to one color. Colors come from tokens.css `--ws-*`; gold is never
// in the palette (it stays reserved for assistant presence).
//
// COUPLING: `sourceLabel` is persona-FIRST — `@vynel/chat`'s
// `composeManagerSourceLabel(workspaceName, managerName)` yields
// "<manager> · <workspace>" (e.g. "Noah · vynel"), or the bare workspace name
// when there's no persona. So the workspace name is the LAST segment. If that
// format ever changes, this normalizer must change with it.

const WORKSPACE_ACCENT_SLOTS = 6;

/** Extract the workspace name from `sourceLabel` (its LAST " · " segment — the
 *  label is "<manager> · <workspace>"), display case preserved. The one home
 *  for that parse — the Watch chip's label and the color slots both use it. */
export function workspaceNameFromLabel(label: string): string {
  return label.split(" · ").at(-1)!.trim();
}

/** Case/whitespace-folded name, so the report row ("Noah · vynel") and the
 *  banner ("vynel") resolve to the same color. */
function normalizeWorkspaceName(label: string): string {
  return workspaceNameFromLabel(label).toLowerCase();
}

/** Deterministic 1..N slot for a workspace name (djb2 — stable, well-spread). */
export function workspaceColorSlot(label: string): number {
  const name = normalizeWorkspaceName(label);
  let hash = 5381;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 33) ^ name.charCodeAt(i);
  }
  return (Math.abs(hash) % WORKSPACE_ACCENT_SLOTS) + 1;
}

/** The workspace's accent as a CSS custom-property reference, e.g. `var(--ws-3)`.
 *  Bind it to `--accent` on a row/chip and the token resolves per theme. */
export function workspaceAccentVar(label: string): string {
  return `var(--ws-${workspaceColorSlot(label)})`;
}
