// WHICH conversation an inbound channel message runs on. The `channels` row
// has carried the scope since day one (`workspaceId` — NULL = global), but the
// Ch4 brain-tree move routed EVERY message to the global root, so a bot bound
// to a workspace still talked to the global brain (Kafi, live 2026-08-21:
// "all telegram channels are talking with global only").
//
// The workspace read goes through the KERNEL repo — the schedules-fire
// precedent (`run-fired-workspace-turn.ts`); a leaf may reach the kernel, never
// a sibling leaf (invariant #2). Same owner check as there: not-found and
// not-owned are one answer, no enumeration leak.
//
// A channel whose workspace is gone falls back to GLOBAL with a warn rather
// than failing the message: an answer on the user's global thread beats
// silence on a channel they are watching.

import { findWorkspaceById } from '@vynel/db/repositories/workspaces'
import type { Database } from '@vynel/db'
import type { Channel } from '../repositories/index.js'
import type { StructuralLogger } from '../channels-types.js'

export type ChannelTurnScope =
  | { kind: 'global' }
  | { kind: 'workspace'; workspaceId: string; workspacePath: string; workspaceName: string }

export function resolveChannelTurnScope(
  db: Database,
  input: {
    channel: Channel
    /** Whether the consumer wired the workspace runner. An embedder without
     *  one (older wiring, tests) keeps the global path — the leaf declares the
     *  runner structurally and must not assume the api bound it. */
    canRunWorkspaceTurn: boolean
  },
  deps: { logger?: StructuralLogger } = {},
): ChannelTurnScope {
  const { channel } = input
  if (channel.workspaceId === null || !input.canRunWorkspaceTurn) return { kind: 'global' }

  const workspace = findWorkspaceById(db, channel.workspaceId)
  if (workspace === null || workspace.userId !== channel.userId) {
    deps.logger?.warn(
      { channelId: channel.id, workspaceId: channel.workspaceId },
      'channel is bound to a workspace that is gone — running this turn on the global conversation',
    )
    return { kind: 'global' }
  }
  return { kind: 'workspace', workspaceId: workspace.id, workspacePath: workspace.path, workspaceName: workspace.name }
}
