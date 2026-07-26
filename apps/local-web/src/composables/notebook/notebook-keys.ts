export const notebookKeys = {
  all: ["notebook"] as const,
  documents: () => [...notebookKeys.all, "documents"] as const,
};
