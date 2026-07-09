import { computed } from "vue";
import { useWorkspaceList } from "./use-workspace-list.js";

/** The scope chip's words for a row that is either global or workspace-owned —
 *  one home for the workspaceId → name lookup every section shares. */
export function useScopeLabel() {
  const workspacesQuery = useWorkspaceList();

  const workspaceNameById = computed(
    () =>
      new Map(
        (workspacesQuery.data.value ?? []).map((row) => [row.id, row.name]),
      ),
  );

  function scopeLabel(workspaceId: string | null): string {
    if (workspaceId === null) return "Global";
    return workspaceNameById.value.get(workspaceId) ?? "Workspace";
  }

  return { scopeLabel };
}
