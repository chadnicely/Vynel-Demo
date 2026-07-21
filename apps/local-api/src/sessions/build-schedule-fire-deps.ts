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
// The MCP attachment comes from `buildWorkspaceBackgroundMcpComposer` — the ONE
// home for background workspace turns (shared with the delegation service), so
// every producer resuming a workspace's continuing conversation attaches the
// same server set (the deferred-tool "server disconnected" class).

import {
  startChatTurn,
  composeSessionCapabilities,
  publishTurnActivityStep,
} from '@vynel/session/runtime'
import type { SessionActivityFeed } from '@vynel/session/runtime'
import type { TurnEventBroadcaster } from '@vynel/session/delegation'
import type { FireScheduleDeps } from '@vynel/schedules'
import type { Database } from '@vynel/db'
import type { Logger } from 'pino'
import type { HonoAppRequestFn } from '../factory.js'
import { buildWorkspaceBackgroundMcpComposer } from './build-workspace-background-mcp.js'

export async function buildScheduleFireDeps(
  db: Database,
  appRequest: HonoAppRequestFn,
  logger: Logger,
  activityFeed: SessionActivityFeed,
  turnEvents?: TurnEventBroadcaster,
): Promise<FireScheduleDeps> {
  // The shared background composer closes over the in-process `appRequest`
  // dispatcher so each fired turn re-enters the api (dynamic MCP import inside).
  const composeWorkspaceMcpServers = await buildWorkspaceBackgroundMcpComposer(appRequest)

  // A fired turn mutates a workspace thread the user may have OPEN, with no
  // other signal — announce it on the session-activity feed like every other
  // turn producer, so the open thread goes live while the schedule runs.
  const announceFiredTurn: typeof startChatTurn = async function* (turnDb, input, turnDeps) {
    const activity = activityFeed.begin({
      userId: input.userId,
      // A fired schedule turn is always workspace-scoped; the runner input's
      // widened `string | null` (spawned-session turns, Slice ③a) can't occur
      // here — the null branch is type-narrowing only (the tick's shape).
      ...(input.workspaceId !== null
        ? { scopeKind: 'workspace' as const, workspaceId: input.workspaceId }
        : { scopeKind: 'global' as const }),
      ...(input.resumeSessionId !== undefined ? { sessionId: input.resumeSessionId } : {}),
      origin: 'schedule',
    })
    try {
      for await (const event of startChatTurn(turnDb, input, {
        ...turnDeps,
        ...(turnEvents !== undefined ? { turnEvents } : {}),
      })) {
        if (event.kind === 'session-created') activity.sessionResolved(event.session.id)
        else if (event.kind === 'user-message-persisted')
          activity.sessionResolved(event.message.sessionId)
        // Narrate tool steps + approval bells on the feed, like every producer.
        publishTurnActivityStep(activity, event)
        yield event
      }
    } finally {
      activity.end()
    }
  }

  return {
    logger,
    composeWorkspaceMcpServers,
    composeSessionCapabilities,
    // The session runtime's `startChatTurn` yields the RUNTIME `ChatTurnEvent`
    // (Date timestamps, `ChatSession` rows); `FireScheduleDeps['startChatTurn']`
    // is typed against the contracts WIRE union. The fire path reads only
    // `session.id` / `textDelta` / `errorMessage` — present on both — so the
    // single documented cast is runtime-safe.
    startChatTurn: announceFiredTurn as unknown as FireScheduleDeps['startChatTurn'],
  }
}
