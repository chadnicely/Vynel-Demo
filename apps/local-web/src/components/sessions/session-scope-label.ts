import type { SessionsOverviewEntry } from "@vynel/contracts/chat/sessions-overview";

/** The identity a session row wears: the global brain presents as the
 *  assistant itself; a workspace session wears its room's name. One home —
 *  the row and the watch panel's title both read it. */
export function sessionScopeLabel(
  entry: Pick<SessionsOverviewEntry, "scope" | "workspaceName">,
): string {
  if (entry.scope === "global") return "Assistant";
  if (entry.scope === "agent") return "Agent";
  if (entry.scope === "spawned") return "Session";
  return entry.workspaceName ?? "Workspace";
}
