// Golden-shape test for the auto-generated MCP tool registry.
// Asserts the expected tool count + names match what the routes
// currently annotate. Drift here means a route added/removed/edited
// its `x-mcp` annotation — re-run `pnpm api:generate` and commit
// the regenerated file. The CI parity guard
// (`scripts/src/generators/check-mcp-parity.ts`) is the wider net
// (catches handler + schema drift too); this test is the fast
// canary for "did the tool list itself change?".

import { describe, expect, it } from 'vitest'
import { generatedMcpTools, generatedRoutingMcpTools } from './api-tools.js'

// The x-mcp-annotated route registry. Sorted to match the generator's
// stable-order emit. As each feature's routes land, its x-mcp tools join
// this list and the count updates in lockstep.
//   - knowledge (`apps/local-api/src/routes/knowledge/index.ts`): 4
//     read-only GETs + 2 mutating source tools (add_to_knowledge /
//     remove_knowledge_source, `mutatingApproved` auto-mode) + list_*.
//   - skills (`apps/local-api/src/routes/skills/index.ts`): 2 read-only
//     GETs (list_available_skills / list_installed_skills); the mutating
//     install/enable/disable/uninstall/settings routes carry NO x-mcp.
//   - channels (`apps/local-api/src/routes/channels/index.ts`): 2 read-only
//     GETs (list_channels / list_allowed_senders); the mutating
//     connect/disconnect/enable/disable/allowed-sender routes carry NO x-mcp
//     (connect carries the bot token — never an MCP tool).
//   - schedules (`apps/local-api/src/routes/schedules/index.ts`): 3 read-only
//     GETs (list_schedules / list_schedule_templates / list_schedule_runs);
//     the mutating create/update/enable/disable/delete routes carry NO x-mcp
//     (and the fire-now route is deferred entirely).
//   - channels USER-scoped (`.../routes/channels/user-scoped.ts`): 1 read-only
//     GET (list_my_channels — a user's global + workspace channels); every
//     mutating route (incl. connect, which carries the bot token) carries NO x-mcp.
//   - schedules USER-scoped (`.../routes/schedules/user-scoped.ts`): 1 read-only
//     GET (list_my_schedules — a user's global + workspace schedules); the
//     mutating create/update/enable/disable/delete routes carry NO x-mcp.
const EXPECTED_TOOL_NAMES = [
  'add_to_knowledge',
  'get_indexer_status',
  'get_knowledge_document',
  'list_allowed_senders',
  'list_available_skills',
  'list_channels',
  'list_installed_skills',
  'list_knowledge_documents',
  'list_knowledge_sources',
  'list_my_channels',
  'list_my_schedules',
  'list_schedule_runs',
  'list_schedule_templates',
  'list_schedules',
  'remove_knowledge_source',
  'search_knowledge',
] as const

// The ROUTING tools live in a SEPARATE array (path-prefix /routing/) — only the
// global-root turn's in-process server gets them, so the normal chat turn stays
// byte-for-byte. Empty until the agent-base routing routes land.
const EXPECTED_ROUTING_TOOL_NAMES = [] as const

const snakeToCamel = (s: string): string => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())

describe('generatedMcpTools', () => {
  it('exposes exactly the annotated knowledge tools (by name)', () => {
    expect(generatedMcpTools).toHaveLength(EXPECTED_TOOL_NAMES.length)
    // The generator names each factory export after its camelCased tool name,
    // so `.name` is the assertion surface (stronger than a bare count).
    expect(generatedMcpTools.map((f) => f.name).sort()).toEqual(
      EXPECTED_TOOL_NAMES.map(snakeToCamel).sort(),
    )
  })

  it('each entry is a factory function (per D5: `(scope, app) => Tool`)', () => {
    for (const factory of generatedMcpTools) {
      expect(typeof factory).toBe('function')
      expect(factory.length).toBe(2) // arity: (scope, app)
    }
  })
})

describe('generatedRoutingMcpTools', () => {
  it('is empty until the routing routes land', () => {
    expect(generatedRoutingMcpTools).toHaveLength(EXPECTED_ROUTING_TOOL_NAMES.length)
    expect(generatedRoutingMcpTools).toHaveLength(0)
  })
})
