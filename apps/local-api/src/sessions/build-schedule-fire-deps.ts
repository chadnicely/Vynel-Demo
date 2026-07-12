// Builds the `FireScheduleDeps` the schedules fire path (`fireSchedule` /
// `manualFireSchedule` / `runScheduleClaimAndFireTick`) runs against. This is
// the api-edge composition point: it binds the headless workspace turn
// (`startChatTurn`), the per-workspace MCP attachment
// (`composeSessionMcpServers([vynelWorkspaceDescriptor], …)`), and the
// capability PROMPT composition (`composeSessionCapabilities`) — the pieces the
// schedules LEAF declares only structurally so it never imports @vynel/mcp,
// @vynel/session, or the composer (invariant #2).
//
// Shared by the boot poll service (`services/schedules-service.ts`) and the
// user-facing `fire-now` routes so both drive the SAME turn machinery.
//
// `@vynel/mcp` is DYNAMICALLY imported (mirrors the source schedules-service +
// chat-turn) — the descriptor pulls the SDK builder + the generated tool
// registry, so deferring the import keeps the static build graph free of the
// heavy MCP module (and the apps↔apps edge) until a schedule actually fires.

import { listEnabledCapabilities } from '@vynel/capabilities'
import { startChatTurn, composeSessionCapabilities } from '@vynel/session/runtime'
import type { FireScheduleDeps } from '@vynel/schedules'
import type { Database } from '@vynel/db'
import type { Logger } from 'pino'
import type { HonoAppRequestFn } from '../factory.js'
import { composeSessionMcpServers } from './compose-session-mcp-servers.js'

export async function buildScheduleFireDeps(
  db: Database,
  appRequest: HonoAppRequestFn,
  logger: Logger,
): Promise<FireScheduleDeps> {
  // Dynamic import — the descriptor's `build` closure wraps the generated tool
  // registry in the SDK's `createSdkMcpServer`; deferring the load keeps the
  // static graph light. The composer + capability composition close over the
  // in-process `appRequest` dispatcher so each fired turn re-enters the api.
  const { vynelWorkspaceDescriptor } = await import('@vynel/mcp')
  const { notebookFeatureDescriptor } = await import('@vynel/instructions')

  return {
    logger,
    composeWorkspaceMcpServers: ({ db: turnDb, userId, workspaceId }) =>
      composeSessionMcpServers(
        [vynelWorkspaceDescriptor, notebookFeatureDescriptor],
        { db: turnDb, userId, workspaceId, appRequest },
        {
          enabledCapabilityIds: new Set(
            listEnabledCapabilities(turnDb, workspaceId).map((capability) => capability.id),
          ),
        },
      ),
    composeSessionCapabilities,
    // The session runtime's `startChatTurn` yields the RUNTIME `ChatTurnEvent`
    // (Date timestamps, `ChatSession` rows); `FireScheduleDeps['startChatTurn']`
    // is typed against the contracts WIRE union. The fire path reads only
    // `session.id` / `textDelta` / `errorMessage` — present on both — so the
    // single documented cast is runtime-safe.
    startChatTurn: startChatTurn as unknown as FireScheduleDeps['startChatTurn'],
  }
}
