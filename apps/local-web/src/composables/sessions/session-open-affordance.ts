// The direct-send rule for an opened session, by scope (persona-sessions B6;
// redesign D7) — the ONE home for the wording both the Sessions view and the
// live pane show. Spawned chain heads chat directly; an agent COLLEAGUE chats
// directly too (G5 shipped: the direct-turn route composes the delegated
// 'agent-session' set + caller identity, same semantics as a mention); a
// primary's conversation carries on in its own chat surface.

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
    case "agent":
      return { chattable: true, viewOnlyNote: null };
    default:
      return {
        chattable: false,
        viewOnlyNote: "This conversation carries on in its own chat.",
      };
  }
}
