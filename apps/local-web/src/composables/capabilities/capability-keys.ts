export const capabilityKeys = {
  all: ["workspace-capabilities"] as const,
  list: (workspaceId: string) => [...capabilityKeys.all, workspaceId] as const,
};
