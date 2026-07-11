export const adminCatalogKeys = {
  all: ["admin-catalog"] as const,
  list: () => [...adminCatalogKeys.all, "list"] as const,
};
