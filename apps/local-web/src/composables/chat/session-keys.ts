import type { SessionScope } from "./session-scope.js";

export const sessionKeys = {
  all: ["chat-sessions"] as const,
  lists: () => [...sessionKeys.all, "list"] as const,
  list: (scopeKey: string) => [...sessionKeys.lists(), scopeKey] as const,
  details: () => [...sessionKeys.all, "detail"] as const,
  detail: (sessionId: string) => [...sessionKeys.details(), sessionId] as const,
  // Under `all` on purpose: every turn-end invalidation (use-chat-turn) also
  // refreshes the cross-scope overview — no second invalidation site.
  overview: () => [...sessionKeys.all, "overview"] as const,
};

export function sessionScopeKey(scope: SessionScope): string {
  return scope.kind === "global" ? "global" : `ws:${scope.workspaceId}`;
}
