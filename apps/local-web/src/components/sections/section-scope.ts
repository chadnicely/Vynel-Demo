// Where a feature section is being viewed/created from — the global menu (the
// brain's overview) or one workspace's drawer. Mirrors the API's discriminated
// scope on user-level creates.
export type SectionScope =
  | { kind: "global" }
  | { kind: "workspace"; workspaceId: string };
