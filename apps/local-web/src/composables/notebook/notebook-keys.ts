export const notebookKeys = {
  all: ["notebook"] as const,
  playbooks: (workspaceId: string | null) =>
    [...notebookKeys.all, "playbooks", workspaceId ?? "global"] as const,
  // The fetched body varies by workspace (workspace context can shape it),
  // so the workspace belongs in the key.
  playbook: (playbookId: string, workspaceId: string | null) =>
    [...notebookKeys.all, "playbook", playbookId, workspaceId ?? "global"] as const,
  documents: () => [...notebookKeys.all, "documents"] as const,
};
