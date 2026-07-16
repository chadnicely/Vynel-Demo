export const askKeys = {
  all: ["asks"] as const,
  pending: () => [...askKeys.all, "pending"] as const,
};
