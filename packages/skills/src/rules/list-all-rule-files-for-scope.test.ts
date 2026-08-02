// The unfiltered rules read behind the Rules view: hand-written files appear
// (the marker-filtered sibling hides them), provenance rides per file, titles
// come from the first heading, and Windows re-saves (BOM/CRLF) stay honest.

import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withHomeDir } from '../internal/resolve-host-home-dir.js'
import { buildRuleFileContent } from './rule-file-marker.js'
import { listAllRuleFilesForScope } from './list-all-rule-files-for-scope.js'

async function withRulesDir<T>(
  scope: 'user' | 'workspace',
  fn: (rulesDir: string, workspaceDir: string) => Promise<T>,
): Promise<T> {
  const homeDir = mkdtempSync(join(tmpdir(), 'vynel-rules-all-home-'))
  const workspaceDir = mkdtempSync(join(tmpdir(), 'vynel-rules-all-ws-'))
  const rulesDir =
    scope === 'user'
      ? join(homeDir, '.claude', 'rules')
      : join(workspaceDir, '.claude', 'rules')
  mkdirSync(rulesDir, { recursive: true })
  try {
    return await withHomeDir(homeDir, () => fn(rulesDir, workspaceDir))
  } finally {
    rmSync(homeDir, { recursive: true, force: true })
    rmSync(workspaceDir, { recursive: true, force: true })
  }
}

describe('listAllRuleFilesForScope', () => {
  it('lists hand-written AND marketplace rules, provenance per file', async () => {
    await withRulesDir('user', async (rulesDir) => {
      writeFileSync(join(rulesDir, 'my-style.md'), '# My style\n\nAlways be brief.\n', 'utf8')
      writeFileSync(
        join(rulesDir, 'git-hygiene.md'),
        buildRuleFileContent('git-hygiene', '2.1.0', '# Git hygiene\n\nSmall commits.'),
        'utf8',
      )

      const rules = listAllRuleFilesForScope('user')
      expect(rules.map((rule) => rule.ruleId)).toEqual(['git-hygiene', 'my-style'])
      expect(rules[0]).toMatchObject({
        title: 'Git hygiene',
        marketplace: { ruleId: 'git-hygiene', version: '2.1.0' },
      })
      expect(rules[1]).toMatchObject({ title: 'My style', marketplace: null })
      expect(rules[1]!.content).toContain('Always be brief.')
    })
  })

  it('a marker naming a different rule (renamed copy) reads as the user\'s own', async () => {
    await withRulesDir('user', async (rulesDir) => {
      writeFileSync(
        join(rulesDir, 'renamed-copy.md'),
        buildRuleFileContent('git-hygiene', '2.1.0', '# Copied'),
        'utf8',
      )
      expect(listAllRuleFilesForScope('user')[0]).toMatchObject({
        ruleId: 'renamed-copy',
        marketplace: null,
      })
    })
  })

  it('falls back to the file name when there is no heading', async () => {
    await withRulesDir('user', async (rulesDir) => {
      writeFileSync(join(rulesDir, 'no-heading.md'), 'Just prose, no title.\n', 'utf8')
      expect(listAllRuleFilesForScope('user')[0]).toMatchObject({ title: 'no-heading' })
    })
  })

  it('tolerates BOM + CRLF re-saves for both title and marker', async () => {
    await withRulesDir('user', async (rulesDir) => {
      const content = buildRuleFileContent('windowsy', '1.0.0', '# Windowsy rule\n\nBody.')
        .replaceAll('\n', '\r\n')
      writeFileSync(join(rulesDir, 'windowsy.md'), `﻿${content}`, 'utf8')
      expect(listAllRuleFilesForScope('user')[0]).toMatchObject({
        title: 'Windowsy rule',
        marketplace: { ruleId: 'windowsy', version: '1.0.0' },
      })
    })
  })

  it('reads the workspace scope folder and ignores non-md files', async () => {
    await withRulesDir('workspace', async (rulesDir, workspaceDir) => {
      writeFileSync(join(rulesDir, 'ws-rule.md'), '# WS rule\n', 'utf8')
      writeFileSync(join(rulesDir, 'notes.txt'), 'not a rule', 'utf8')
      const rules = listAllRuleFilesForScope('workspace', workspaceDir)
      expect(rules.map((rule) => rule.ruleId)).toEqual(['ws-rule'])
    })
  })

  it('answers empty when the folder does not exist', () => {
    expect(
      listAllRuleFilesForScope('workspace', join(tmpdir(), 'vynel-rules-none-does-not-exist')),
    ).toEqual([])
  })
})
