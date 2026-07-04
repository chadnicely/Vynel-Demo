// The manager prompt is LOAD-BEARING: LLM-native routing only works if the model
// calls the routing tools, and that hinges on the prompt naming them. This guard
// fails loudly if a future edit drops a tool reference.

import { describe, it, expect } from 'vitest'
import { GLOBAL_ROOT_INSTRUCTIONS } from './global-root-instructions.js'

// The desktop tool guide moved to @vynel/desktop-control with the feature; its
// load-bearing guards live in desktop-tool-instructions.test.ts there.

describe('GLOBAL_ROOT_INSTRUCTIONS', () => {
  it('names all four tools and frames the global root as a router, not a worker', () => {
    expect(GLOBAL_ROOT_INSTRUCTIONS).toContain('list_routing_workspaces')
    expect(GLOBAL_ROOT_INSTRUCTIONS).toContain('route_to_workspace')
    // Ch4 §D — the channel send tools must be named too, or the model won't call them.
    expect(GLOBAL_ROOT_INSTRUCTIONS).toContain('list_routing_channels')
    expect(GLOBAL_ROOT_INSTRUCTIONS).toContain('send_to_channel')
    // The manager must be told to route, not do the work itself.
    expect(GLOBAL_ROOT_INSTRUCTIONS.toLowerCase()).toContain('route')
  })
})
