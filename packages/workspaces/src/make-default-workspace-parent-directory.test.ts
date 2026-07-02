// Test for makeDefaultWorkspaceParentDirectory.

import { describe, it, expect } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import { makeDefaultWorkspaceParentDirectory } from './make-default-workspace-parent-directory.js'

describe('makeDefaultWorkspaceParentDirectory', () => {
  it('returns ~/Documents/Vynel', () => {
    expect(makeDefaultWorkspaceParentDirectory()).toBe(
      path.join(os.homedir(), 'Documents', 'Vynel'),
    )
  })
})
