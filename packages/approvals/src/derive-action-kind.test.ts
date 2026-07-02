// Table-driven coverage of `deriveActionKind`. The mapping table is the
// taxonomy contract — every row here ties one input to its expected
// kind. Adding a new mapping requires a new row here.

import { describe, expect, it } from 'vitest'
import { deriveActionKind } from './derive-action-kind.js'
import type { ActionKind } from './approvals-types.js'

describe('deriveActionKind', () => {
  const cases: Array<{ toolName: string; expected: ActionKind }> = [
    // Exact matches — Claude's file-system tools
    { toolName: 'Write', expected: 'file-write' },
    { toolName: 'Edit', expected: 'file-edit' },
    { toolName: 'MultiEdit', expected: 'file-edit' },
    { toolName: 'NotebookEdit', expected: 'file-edit' },

    // Exact matches — Claude's shell tools
    { toolName: 'Bash', expected: 'shell-command' },
    { toolName: 'BashOutput', expected: 'shell-command' },
    { toolName: 'KillShell', expected: 'shell-command' },

    // Prefix matches — MCP email tools
    { toolName: 'mcp__gmail__send_message', expected: 'email-send' },
    { toolName: 'mcp__email__send', expected: 'email-send' },

    // Prefix matches — MCP calendar tools
    { toolName: 'mcp__google_calendar__create_event', expected: 'calendar-write' },
    { toolName: 'mcp__calendar__create_event', expected: 'calendar-write' },

    // Prefix matches — Vynel memory writes
    { toolName: 'mcp__vynel_memory__write_entry', expected: 'memory-write' },
    { toolName: 'mcp__vynel_memory__add_entry', expected: 'memory-write' },

    // Generic external-action — mcp__*__* with write-shaped verb
    { toolName: 'mcp__notion__create_page', expected: 'external-action' },
    { toolName: 'mcp__slack__post_message', expected: 'external-action' },
    { toolName: 'mcp__random__delete_resource', expected: 'external-action' },

    // 'other' — unrecognized read-shaped tools
    { toolName: 'Glob', expected: 'other' },
    { toolName: 'Read', expected: 'other' },
    { toolName: 'Grep', expected: 'other' },
    { toolName: 'LS', expected: 'other' },
    { toolName: 'WebFetch', expected: 'other' },
    { toolName: 'mcp__readonly__get_user', expected: 'other' },
    { toolName: 'mcp__readonly__list_files', expected: 'other' },

    // 'other' — completely unknown
    { toolName: 'SomeMadeUpTool', expected: 'other' },
    { toolName: '', expected: 'other' },
  ]

  for (const { toolName, expected } of cases) {
    it(`maps ${JSON.stringify(toolName)} -> ${expected}`, () => {
      expect(deriveActionKind(toolName)).toBe(expected)
    })
  }

  it('is case-insensitive on the write-verb fallback', () => {
    expect(deriveActionKind('mcp__service__CREATE_thing')).toBe('external-action')
    expect(deriveActionKind('mcp__service__Send_thing')).toBe('external-action')
  })
})
