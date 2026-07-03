// The desktop tool guide is LOAD-BEARING: without the "answer directly, don't
// route" carve-out, the route-only global-root base would steer a "what did I
// miss?" request DOWN to a workspace that has no desktop tool — green gate, dead
// feature. These guards fail loudly if a future edit drops a tool reference or
// the safety line. (Moved here from apps/local-api with the feature in the C4 build.)

import { describe, it, expect } from 'vitest'
import { DESKTOP_TOOL_INSTRUCTIONS, DESKTOP_ACT_INSTRUCTIONS } from './desktop-tool-instructions.js'

describe('DESKTOP_TOOL_INSTRUCTIONS', () => {
  it('names the notification tool and tells the brain to answer directly, not route', () => {
    expect(DESKTOP_TOOL_INSTRUCTIONS).toContain('list_desktop_notifications')
    expect(DESKTOP_TOOL_INSTRUCTIONS.toLowerCase()).toContain('directly')
    expect(DESKTOP_TOOL_INSTRUCTIONS.toLowerCase()).toContain('do not route')
  })

  it('names the desktop-observation read tools (apps + snapshot)', () => {
    expect(DESKTOP_TOOL_INSTRUCTIONS).toContain('list_open_apps')
    expect(DESKTOP_TOOL_INSTRUCTIONS).toContain('snapshot_app')
  })
})

describe('DESKTOP_ACT_INSTRUCTIONS', () => {
  it('names act_on_app and requires asking before irreversible actions', () => {
    // Appended only when desktop actions are enabled; the ask-before-irreversible
    // line is the interim safety (the hard approval card is a separate end-step),
    // so it must survive any future edit.
    expect(DESKTOP_ACT_INSTRUCTIONS).toContain('act_on_app')
    expect(DESKTOP_ACT_INSTRUCTIONS.toLowerCase()).toContain('irreversible')
    expect(DESKTOP_ACT_INSTRUCTIONS.toLowerCase()).toContain('ask the user')
  })
})
