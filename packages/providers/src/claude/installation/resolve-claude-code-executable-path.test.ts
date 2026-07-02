// Smoke test for `resolveClaudeCodeExecutablePath`. The platform-branch +
// PATH-search behaviour is exercised end-to-end by the step-27 smoke test
// against real Claude Code; here we only assert it runs and yields a
// claude-shaped path. See `docs/blueprints/providers/blueprint.md §11.5`.

import { describe, expect, it } from 'vitest'
import { resolveClaudeCodeExecutablePath } from './resolve-claude-code-executable-path.js'

describe('resolveClaudeCodeExecutablePath', () => {
  it('returns a non-empty path referencing the claude executable', () => {
    const resolved = resolveClaudeCodeExecutablePath()
    expect(resolved.length).toBeGreaterThan(0)
    expect(resolved.toLowerCase()).toContain('claude')
  })
})
