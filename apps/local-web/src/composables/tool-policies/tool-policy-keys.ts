export const toolPolicyKeys = {
  all: ["tool-policies"] as const,
  list: () => [...toolPolicyKeys.all, "list"] as const,
};
