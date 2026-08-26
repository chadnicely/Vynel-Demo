export const rulesKeys = {
  all: ["rules"] as const,
  list: (surface: string) => [...rulesKeys.all, "list", surface] as const,
};
