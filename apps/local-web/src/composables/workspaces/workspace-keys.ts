export const workspaceKeys = {
  all: ["workspaces"] as const,
  lists: () => [...workspaceKeys.all, "list"] as const,
  directories: (path: string | null) =>
    [...workspaceKeys.all, "directories", path ?? "home"] as const,
};
