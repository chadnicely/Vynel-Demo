// The BACKGROUND workspace turn's MCP attachment — ONE home for every headless
// turn producer that resumes a workspace's continuing conversation (schedule
// fires via `buildScheduleFireDeps`, delegated runs via `delegation-service`).
//
// WHY one home: a workspace's primary conversation is ONE resumed SDK session
// shared by every turn producer. The SDK's deferred-tool reconciliation compares
// each turn's toolset against what the session already knew — a producer that
// attaches NOTHING makes the CLI strip every `mcp__vynel*` tool and tell the
// model "MCP server disconnected" (the 2026-07-21 live bug: delegated turns ran
// bare, so the workspace brain reported the whole Vynel server offline and the
// belief persisted into later interactive turns). Every background producer must
// therefore attach the SAME background set; interactive streams alone add the
// interactive-only features (session-spawning trio, ask, ssh) on top.
//
// `@vynel/mcp` is DYNAMICALLY imported (the chat-turn/schedules precedent) — the
// descriptor pulls the SDK builder + the generated tool registry, so deferring
// keeps the static build graph light until a background turn actually needs it.

import type { Database } from '@vynel/db'
import { listEnabledCapabilities } from '@vynel/capabilities'
import type { HonoAppRequestFn } from '../factory.js'
import {
  composeSessionMcpServers,
  type ComposedSessionMcpServers,
} from './compose-session-mcp-servers.js'

export type WorkspaceBackgroundMcpComposer = (input: {
  db: Database
  userId: string
  workspaceId: string
}) => ComposedSessionMcpServers

export async function buildWorkspaceBackgroundMcpComposer(
  appRequest: HonoAppRequestFn,
): Promise<WorkspaceBackgroundMcpComposer> {
  const { vynelWorkspaceDescriptor } = await import('@vynel/mcp')
  const { notebookFeatureDescriptor } = await import('@vynel/instructions')
  return ({ db, userId, workspaceId }) =>
    composeSessionMcpServers(
      [vynelWorkspaceDescriptor, notebookFeatureDescriptor],
      { db, userId, workspaceId, appRequest },
      {
        enabledCapabilityIds: new Set(
          listEnabledCapabilities(db, workspaceId).map((capability) => capability.id),
        ),
      },
    )
}
