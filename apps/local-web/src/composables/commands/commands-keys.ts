export const commandsKeys = {
  all: ["commands"] as const,
  list: (kind: "owned" | "resolved", surface: string) =>
    [...commandsKeys.all, kind, surface] as const,
};
