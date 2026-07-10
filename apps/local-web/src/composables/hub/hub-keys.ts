export const hubKeys = {
  all: ["hub"] as const,
  session: () => [...hubKeys.all, "session"] as const,
  devices: () => [...hubKeys.all, "devices"] as const,
};
