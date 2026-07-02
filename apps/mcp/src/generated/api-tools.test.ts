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

// Knowledge-slice registry — the only x-mcp-annotated routes landed so
// far are the four read-only knowledge GETs (`apps/local-api/src/routes/
// knowledge/index.ts`). Sorted to match the generator's stable-order
// emit. As each feature's routes land (memory, channels, schedules, …),
// its x-mcp tools join this list and the count updates in lockstep.
const EXPECTED_TOOL_NAMES = [
  'get_indexer_status',
  'get_knowledge_document',
  'list_knowledge_documents',
  'search_knowledge',
] as const

// The ROUTING tools live in a SEPARATE array (path-prefix /routing/) — only the
// global-root turn's in-process server gets them, so the normal chat turn stays
// byte-for-byte. Empty until the agent-base routing routes land.
const EXPECTED_ROUTING_TOOL_NAMES = [] as const

describe('generatedMcpTools', () => {
  it('exposes the four read-only knowledge tools', () => {
    expect(generatedMcpTools).toHaveLength(EXPECTED_TOOL_NAMES.length)
    expect(generatedMcpTools).toHaveLength(4)
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
