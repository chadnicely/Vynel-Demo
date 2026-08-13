// The `vynel-notebook` MCP feature descriptor — the notebook's read tools
// expressed as the shared `McpFeatureDescriptor` so the apps/local-api
// composer attaches them to a turn the same way it attaches `vynel` and
// `desktop`. Registered on BOTH workspace turns and global-root turns (the
// brain plans multi-step work too).
//
// `context.db` is `unknown` in the dependency-light contract; this is the
// producer boundary that owns the notebook server, so it casts to `Database`
// once (documented) — the `vynel` descriptor precedent.

import type { Database } from '@vynel/db'
import type { McpFeatureDescriptor, SessionToolContext } from '@vynel/mcp-contract'
import { buildNotebookMcpServer } from './build-notebook-mcp-server.js'
import type { PlaybookShelfScope } from './playbook-shelf.js'

// The one standing line a turn carries about the notebook — everything else
// is fetched on demand (injecting books wholesale would burn every turn's
// context on recipes that mostly don't apply; see the module notes).
export const NOTEBOOK_PROMPT_INSTRUCTIONS =
  'You have a notebook of playbooks — books of current, curated guidance (verified ones are maintained ' +
  'by the Vynel team). Before starting a multi-step project or task, call list_playbooks; if a book ' +
  'matches the task, read it and prefer its guidance over your own assumptions.'

function toShelfScope(context: SessionToolContext): PlaybookShelfScope {
  return {
    userId: context.userId,
    ...(context.workspaceId !== undefined ? { workspaceId: context.workspaceId } : {}),
  }
}

// READ-ONLY feature: no mutating tools, ever, in v1 (settled fork #1). Gated
// by the `notebook` capability (defaultEnabled — a toggle row turns it off).
export const notebookFeatureDescriptor: McpFeatureDescriptor = {
  serverName: 'vynel-notebook',
  toolNames: ['mcp__vynel-notebook__list_playbooks', 'mcp__vynel-notebook__read_playbook'],
  build: (context) =>
    // The one documented producer-boundary cast — see file header.
    buildNotebookMcpServer(context.db as Database, toShelfScope(context)),
  mutatingToolNames: [],
  capabilityGatedTools: {
    notebook: ['mcp__vynel-notebook__list_playbooks', 'mcp__vynel-notebook__read_playbook'],
  },
  contributePrompt: () => NOTEBOOK_PROMPT_INSTRUCTIONS,
}
