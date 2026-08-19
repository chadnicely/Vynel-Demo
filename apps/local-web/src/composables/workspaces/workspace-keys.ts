export const workspaceKeys = {
  all: ["workspaces"] as const,
  lists: () => [...workspaceKeys.all, "list"] as const,
  groups: () => [...workspaceKeys.all, "groups"] as const,
  statuses: () => [...workspaceKeys.all, "statuses"] as const,
  directoryListings: () => [...workspaceKeys.all, "directories"] as const,
  directories: (path: string | null) =>
    [...workspaceKeys.directoryListings(), path ?? "home"] as const,
};
