export const dashboardKeys = {
  all: ["dashboard"] as const,
  overview: () => [...dashboardKeys.all, "overview"] as const,
  // scope: "all" for the user-wide read, otherwise the workspaceId.
  usage: (scope: string, days: number) =>
    [...dashboardKeys.all, "usage", scope, days] as const,
};
