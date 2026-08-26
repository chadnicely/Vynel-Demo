export const skillsKeys = {
  all: ["skills"] as const,
  installed: (kind: "owned" | "resolved", surface: string) =>
    [...skillsKeys.all, "installed", kind, surface] as const,
  files: (surface: string, skillId: string, relativePath: string) =>
    [...skillsKeys.all, "files", surface, skillId, relativePath] as const,
};
