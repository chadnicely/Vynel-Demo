import type { SessionScope } from "./session-scope.js";

export const sessionKeys = {
  all: ["chat-sessions"] as const,
  lists: () => [...sessionKeys.all, "list"] as const,
  list: (scopeKey: string) => [...sessionKeys.lists(), scopeKey] as const,
  details: () => [...sessionKeys.all, "detail"] as const,
  detail: (sessionId: string) => [...sessionKeys.details(), sessionId] as const,
};

export function sessionScopeKey(scope: SessionScope): string {
  return scope.kind === "global" ? "global" : `ws:${scope.workspaceId}`;
}
