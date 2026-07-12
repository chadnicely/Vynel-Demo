export const adminAccountsKeys = {
  all: ["admin-accounts"] as const,
  list: () => [...adminAccountsKeys.all, "list"] as const,
};
