import type { SessionScope } from "./session-scope.js";

export const sessionKeys = {
  all: ["chat-sessions"] as const,
  lists: () => [...sessionKeys.all, "list"] as const,
  list: (scopeKey: string) => [...sessionKeys.lists(), scopeKey] as const,
  details: () => [...sessionKeys.all, "detail"] as const,
  // Scope rides the key: the detail queryFn is scope-ROUTED (`root.getSession`
  // vs `chat.getSession`, and the root read decorates report rows with
  // delegationTaskLabel) — a scope-blind key would let two observers with
  // different fetchers share one cache entry (the activity monitor watches any
  // session via the root read while a workspace thread reads its own route).
  detail: (scopeKey: string, sessionId: string) =>
    [...sessionKeys.details(), scopeKey, sessionId] as const,
  // Under `all` on purpose: every turn-end invalidation (use-chat-turn) also
  // refreshes the cross-scope overview — no second invalidation site.
  overview: () => [...sessionKeys.all, "overview"] as const,
};

export function sessionScopeKey(scope: SessionScope): string {
  return scope.kind === "global" ? "global" : `ws:${scope.workspaceId}`;
}
