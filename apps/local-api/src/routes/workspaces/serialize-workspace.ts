// The one home for the workspace row → `WorkspaceResponse` shape. Every
// workspace route answers with it (list, register, get, patch, archive,
// unarchive — and the wizard's scaffold), so dates serialize the same way
// everywhere.

import type { Workspace } from '@vynel/workspaces'
import type { WorkspaceResponse } from '@vynel/contracts/workspaces/workspace-http'

export function serializeWorkspaceForResponse(workspace: Workspace): WorkspaceResponse {
  return {
    id: workspace.id,
    userId: workspace.userId,
    name: workspace.name,
    managerName: workspace.managerName,
    kind: workspace.kind,
    path: workspace.path,
    isArchived: workspace.isArchived,
    continueEnabled: workspace.continueEnabled,
    groupId: workspace.groupId,
    status: workspace.status,
    statusNote: workspace.statusNote,
    statusSetAt: workspace.statusSetAt?.toISOString() ?? null,
    setupCompletedAt: workspace.setupCompletedAt?.toISOString() ?? null,
    createdAt: workspace.createdAt.toISOString(),
    updatedAt: workspace.updatedAt.toISOString(),
    lastAccessedAt: workspace.lastAccessedAt.toISOString(),
  }
}
