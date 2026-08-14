export const toolPolicyKeys = {
  all: ["tool-policy"] as const,
  list: () => [...toolPolicyKeys.all, "list"] as const,
  map: () => [...toolPolicyKeys.all, "map"] as const,
};
