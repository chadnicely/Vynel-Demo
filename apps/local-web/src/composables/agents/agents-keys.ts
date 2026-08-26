export const agentsKeys = {
  all: ["agents"] as const,
  list: (kind: "list" | "resolved", surface: string) =>
    [...agentsKeys.all, kind, surface] as const,
  files: (surface: string) => [...agentsKeys.all, "files", surface] as const,
  curated: () => [...agentsKeys.all, "curated"] as const,
};
