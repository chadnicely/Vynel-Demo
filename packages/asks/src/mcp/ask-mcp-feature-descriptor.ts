// The `vynel-ask` MCP feature descriptor — `ask_user` expressed as the shared
// `McpFeatureDescriptor` so the apps/local-api composer attaches it like every
// other feature. Attached to the interactive app turns (unbounded wait — the
// user is present) AND to channel turns with a bounded `timeoutMs` (module
// notes fork #2, revised by the tool-policy arc: the Telegram nudge makes an
// unattended ask answerable, and expiry keeps it from parking the job).
//
// A FACTORY, not a static export (the notebook precedent doesn't fit): the
// tool must park on the process-wide waiter registry, which the composer's
// SessionToolContext doesn't carry — the api edge builds the descriptor once
// with its registry instance and passes it to the turn points.
//
// `context.db` is `unknown` in the dependency-light contract; this is the
// producer boundary that owns the ask server, so it casts to `Database` once.

import type { Database } from '@vynel/db'
import type { McpFeatureDescriptor } from '@vynel/mcp-contract'
import { buildAskMcpServer } from './build-ask-mcp-server.js'
import type { AskUserToolDeps } from './ask-user-tool.js'

// The one standing line an interactive turn carries about asking. WHEN to ask
// lives here; HOW (types, plain language, one form) lives in the tool
// description the model reads at call time.
export const ASK_PROMPT_INSTRUCTIONS =
  'When you are genuinely blocked on the user\'s preference or information you cannot find ' +
  'yourself, use ask_user to show them a short form instead of asking questions in chat — ' +
  'bundle related questions into one call. Never use it for what you can look up, and never ' +
  're-ask what memory already knows. This works in EVERY mode, auto and bypass included: those ' +
  'modes mean "don\'t ask permission", not "never check a preference" — when a consequential ' +
  'choice is genuinely ambiguous and getting it wrong would waste the user\'s work, asking is ' +
  'your call to make. If the result comes back unanswered or expired, proceed with your best ' +
  'judgment and say what you assumed.'

export function buildAskFeatureDescriptor(deps: AskUserToolDeps): McpFeatureDescriptor {
  return {
    serverName: 'vynel-ask',
    toolNames: ['mcp__vynel-ask__ask_user'],
    build: (context) =>
      buildAskMcpServer(
        // The one documented producer-boundary cast — see file header.
        context.db as Database,
        {
          userId: context.userId,
          workspaceId: context.workspaceId ?? null,
          ...(context.sessionId !== undefined ? { sessionId: context.sessionId } : {}),
        },
        deps,
      ),
    // Asking is reversible plumbing — never carded.
    mutatingToolNames: [],
    contributePrompt: () => ASK_PROMPT_INSTRUCTIONS,
  }
}
