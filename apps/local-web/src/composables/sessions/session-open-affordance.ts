// The direct-send rule for an opened session, by scope (persona-sessions B6;
// locked decisions 1–3) — the ONE home for the wording both the Sessions view
// and the monitor's live pane show. Spawned chain heads chat directly; an
// agent COLLEAGUE is spoken to by @mention (widening the direct-turn route to
// agent scope needs MCP-set parity — the deliberate deferral recorded in the
// module notes); a primary's conversation carries on in its own chat surface.

import type { SessionsOverviewEntry } from "@vynel/contracts/chat/sessions-overview";

export interface SessionOpenAffordance {
  chattable: boolean;
  viewOnlyNote: string | null;
}

export function sessionOpenAffordance(
  scope: SessionsOverviewEntry["scope"],
): SessionOpenAffordance {
  switch (scope) {
    case "spawned":
      return { chattable: true, viewOnlyNote: null };
    case "agent":
      return {
        chattable: false,
        viewOnlyNote:
          "This colleague works from chat — @mention them there to send a message.",
      };
    default:
      return {
        chattable: false,
        viewOnlyNote: "This conversation carries on in its own chat.",
      };
  }
}
