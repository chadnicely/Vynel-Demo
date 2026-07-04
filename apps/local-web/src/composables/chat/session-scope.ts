// Where a chat surface points: the global root, or one workspace. A permanent
// domain concept (NOT demo-owned) — the demo namespaces and the future real
// SDK calls both key off it.
export type SessionScope =
  { kind: "global" } | { kind: "workspace"; workspaceId: string };
