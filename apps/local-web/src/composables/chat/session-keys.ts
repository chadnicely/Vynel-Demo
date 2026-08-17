import type { SessionScope } from "./session-scope.js";

export const sessionKeys = {
  all: ["chat-sessions"] as const,
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
  // The Sessions library's PAGED read — a separate cache entry per scope, and
  // separate from `overview()` because the two answer different questions: the
  // overview is "the recent conversations everything derives status from", the
  // library is "every conversation in this scope, a page at a time". Also
  // under `all`, so a turn-end invalidation refreshes both.
  library: (scopeKey: string) => [...sessionKeys.all, "library", scopeKey] as const,
  // The per-session composer settings (mode/model/effort/auto-buildout).
  // Under `all` so the turn-end invalidation also reconciles a write-through
  // the server did during the turn.
  settings: (sessionId: string) => [...sessionKeys.all, "settings", sessionId] as const,
};

export function sessionScopeKey(scope: SessionScope): string {
  return scope.kind === "global" ? "global" : `ws:${scope.workspaceId}`;
}
