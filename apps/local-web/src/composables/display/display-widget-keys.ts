export const displayWidgetKeys = {
  all: ["display-widgets"] as const,
  /** `'global'` or a workspace id — the board is read one scope at a time. */
  scope: (scopeKey: string) => [...displayWidgetKeys.all, scopeKey] as const,
};
