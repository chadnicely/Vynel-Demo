// The `vynel-ask` MCP feature descriptor — `ask_user` expressed as the shared
// `McpFeatureDescriptor` so the apps/local-api composer attaches it like every
// other feature. Attached to the INTERACTIVE app turns ONLY (workspace chat +
// global chat streams) — never schedule fires or channel turns, where nobody
// is looking at the app to answer (module notes fork #2).
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
  're-ask what memory already knows.'

export function buildAskFeatureDescriptor(deps: AskUserToolDeps): McpFeatureDescriptor {
  return {
    serverName: 'vynel-ask',
    build: (context) =>
      buildAskMcpServer(
        // The one documented producer-boundary cast — see file header.
        context.db as Database,
        { userId: context.userId, workspaceId: context.workspaceId ?? null },
        deps,
      ),
    // Asking is reversible plumbing — never carded.
    mutatingToolNames: [],
    contributePrompt: () => ASK_PROMPT_INSTRUCTIONS,
  }
}
