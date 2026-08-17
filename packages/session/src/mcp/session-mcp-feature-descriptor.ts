// The `vynel-session` MCP feature descriptor — `whoami` expressed as the shared
// `McpFeatureDescriptor` so the apps/local-api composer attaches it to EVERY
// turn kind the same way it attaches `vynel-notebook`: the global root, the
// workspace streams, every delegated runner, schedule fires. Requirement 2 of
// the continuity arc — all sessions the same way — applies to self-knowledge
// too: a spawned session working on one feature must be able to say who it is
// as readily as the global assistant.
//
// A FACTORY (the `vynel-ask` precedent): the swap threshold the runners honor
// is an apps-edge env knob the composer's context does not carry; the edge
// builds the descriptor with it so `whoami` reports the threshold that is
// actually in force (a live smoke at 5% must not read "85%").
//
// `context.db` is `unknown` in the dependency-light contract; this is the
// producer boundary that owns the session server, so it casts to `Database`
// once (documented) — the notebook / ask precedent.

import type { Database } from '@vynel/db'
import type { McpFeatureDescriptor, SessionToolContext } from '@vynel/mcp-contract'
import { buildSessionMcpServer, SESSION_MCP_SERVER_NAME } from './build-session-mcp-server.js'
import type { WhoamiToolScope } from './whoami-tool.js'

export const WHOAMI_TOOL_NAME = `mcp__${SESSION_MCP_SERVER_NAME}__whoami`

// The one standing line every turn carries about self-knowledge — the tool
// description says the rest at call time.
export const SESSION_PROMPT_INSTRUCTIONS =
  'You can call whoami to learn which conversation you are, how full your context is before it ' +
  'continues on a fresh one, which duty book teaches your kind, and the memory tags that mark ' +
  'what you save as yours — use those tags whenever you save a memory.'

export type SessionFeatureDescriptorDeps = {
  /** The swap threshold in force (the env override the runners honor); omit for the default. */
  swapThreshold?: number
}

/** The turn's own identity facts, straight from the compose context — the
 *  stable primary id (`sessionId`), the ground, and the LAZY chat id. */
export function resolveWhoamiScope(
  context: SessionToolContext,
  deps: SessionFeatureDescriptorDeps,
): WhoamiToolScope {
  return {
    userId: context.userId,
    ...(context.sessionId !== undefined ? { primarySessionId: context.sessionId } : {}),
    ...(context.workspaceId !== undefined ? { workspaceId: context.workspaceId } : {}),
    ...(context.resolveChatSessionId !== undefined
      ? { resolveChatSessionId: context.resolveChatSessionId }
      : {}),
    ...(deps.swapThreshold !== undefined ? { swapThreshold: deps.swapThreshold } : {}),
  }
}

export function buildSessionFeatureDescriptor(
  deps: SessionFeatureDescriptorDeps = {},
): McpFeatureDescriptor {
  return {
    serverName: SESSION_MCP_SERVER_NAME,
    toolNames: [WHOAMI_TOOL_NAME],
    build: (context) =>
      // The one documented producer-boundary cast — see file header.
      buildSessionMcpServer(context.db as Database, resolveWhoamiScope(context, deps)),
    // Reading yourself is never carded.
    mutatingToolNames: [],
    contributePrompt: () => SESSION_PROMPT_INSTRUCTIONS,
  }
}
