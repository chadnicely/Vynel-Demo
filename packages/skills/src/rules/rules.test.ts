// The marketplace rule-file ops over a real isolated home + workspace dir:
// install/list/remove round-trip per scope, and the provenance-marker
// protections — a hand-authored file is never listed, never overwritten,
// never deleted.

import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withHomeDir } from '../internal/resolve-host-home-dir.js'
import { installRuleFileForScope } from './install-rule-file-for-scope.js'
import { removeRuleFileForScope } from './remove-rule-file-for-scope.js'
import { listInstalledRulesForScope } from './list-installed-rules-for-scope.js'

async function withIsolatedDirs<T>(
  fn: (homeDir: string, workspaceDir: string) => Promise<T>,
): Promise<T> {
  const homeDir = mkdtempSync(join(tmpdir(), 'vynel-rules-home-'))
  const workspaceDir = mkdtempSync(join(tmpdir(), 'vynel-rules-ws-'))
  try {
    return await withHomeDir(homeDir, () => fn(homeDir, workspaceDir))
  } finally {
    rmSync(homeDir, { recursive: true, force: true })
    rmSync(workspaceDir, { recursive: true, force: true })
  }
}

describe('marketplace rule-file ops', () => {
  it('user scope: install → marked file in ~/.claude/rules → listed → remove → gone', async () => {
    await withIsolatedDirs(async (homeDir) => {
      expect(listInstalledRulesForScope('user')).toEqual([])

      await installRuleFileForScope({
        scope: 'user',
        ruleId: 'conventional-commits',
        version: '1.0.0',
        ruleMarkdown: '# Conventional Commits\n\nUse type(scope): description.',
      })

      const filePath = join(homeDir, '.claude', 'rules', 'conventional-commits.md')
      const written = readFileSync(filePath, 'utf8')
      expect(written.startsWith('<!-- vynel-marketplace-rule: conventional-commits v1.0.0 -->')).toBe(
        true,
      )
      expect(written).toContain('# Conventional Commits')
      expect(listInstalledRulesForScope('user')).toEqual([
        { ruleId: 'conventional-commits', version: '1.0.0' },
      ])

      await removeRuleFileForScope({ scope: 'user', ruleId: 'conventional-commits' })
      expect(existsSync(filePath)).toBe(false)
      expect(listInstalledRulesForScope('user')).toEqual([])
    })
  })

  it('workspace scope: the file lands under <workspace>/.claude/rules', async () => {
    await withIsolatedDirs(async (_homeDir, workspaceDir) => {
      await installRuleFileForScope({
        scope: 'workspace',
        workspacePath: workspaceDir,
        ruleId: 'conventional-commits',
        version: '1.0.0',
        ruleMarkdown: 'body',
      })
      expect(existsSync(join(workspaceDir, '.claude', 'rules', 'conventional-commits.md'))).toBe(true)
      expect(listInstalledRulesForScope('workspace', workspaceDir)).toHaveLength(1)
      expect(listInstalledRulesForScope('user')).toEqual([])
    })
  })

  it('a hand-authored rule file is never listed, never overwritten, never deleted', async () => {
    await withIsolatedDirs(async (homeDir) => {
      const rulesDir = join(homeDir, '.claude', 'rules')
      mkdirSync(rulesDir, { recursive: true })
      const handMade = join(rulesDir, 'security.md')
      writeFileSync(handMade, '# My own security rules\n', 'utf8')

      expect(listInstalledRulesForScope('user')).toEqual([])

      await expect(
        installRuleFileForScope({
          scope: 'user',
          ruleId: 'security',
          version: '1.0.0',
          ruleMarkdown: 'catalog version',
        }),
      ).rejects.toMatchObject({ code: 'conflict' })

      await expect(
        removeRuleFileForScope({ scope: 'user', ruleId: 'security' }),
      ).rejects.toMatchObject({ code: 'conflict' })

      expect(readFileSync(handMade, 'utf8')).toBe('# My own security rules\n')
    })
  })

  it('re-install over a MARKED file refreshes it (repair / version bump)', async () => {
    await withIsolatedDirs(async (homeDir) => {
      await installRuleFileForScope({
        scope: 'user',
        ruleId: 'conventional-commits',
        version: '1.0.0',
        ruleMarkdown: 'v1 body',
      })
      await installRuleFileForScope({
        scope: 'user',
        ruleId: 'conventional-commits',
        version: '1.1.0',
        ruleMarkdown: 'v2 body',
      })
      const written = readFileSync(
        join(homeDir, '.claude', 'rules', 'conventional-commits.md'),
        'utf8',
      )
      expect(written).toContain('v1.1.0 -->')
      expect(written).toContain('v2 body')
      expect(listInstalledRulesForScope('user')).toEqual([
        { ruleId: 'conventional-commits', version: '1.1.0' },
      ])
    })
  })

  it("install refuses a renamed copy of ANOTHER rule's file (marker-id mismatch)", async () => {
    await withIsolatedDirs(async (homeDir) => {
      await installRuleFileForScope({
        scope: 'user',
        ruleId: 'conventional-commits',
        version: '1.0.0',
        ruleMarkdown: 'body',
      })
      // The user copies the installed file under a name that collides with
      // a DIFFERENT catalog id — its marker still names the original rule,
      // so it is theirs now; Get for the colliding id must not clobber it.
      const rulesDir = join(homeDir, '.claude', 'rules')
      const content = readFileSync(join(rulesDir, 'conventional-commits.md'), 'utf8')
      writeFileSync(join(rulesDir, 'error-handling.md'), content, 'utf8')

      await expect(
        installRuleFileForScope({
          scope: 'user',
          ruleId: 'error-handling',
          version: '1.0.0',
          ruleMarkdown: 'catalog version',
        }),
      ).rejects.toMatchObject({ code: 'conflict' })
      expect(readFileSync(join(rulesDir, 'error-handling.md'), 'utf8')).toBe(content)
    })
  })

  it('a hand-renamed marked file no longer annotates (marker/name mismatch)', async () => {
    await withIsolatedDirs(async (homeDir) => {
      await installRuleFileForScope({
        scope: 'user',
        ruleId: 'conventional-commits',
        version: '1.0.0',
        ruleMarkdown: 'body',
      })
      const rulesDir = join(homeDir, '.claude', 'rules')
      const content = readFileSync(join(rulesDir, 'conventional-commits.md'), 'utf8')
      writeFileSync(join(rulesDir, 'my-copy.md'), content, 'utf8')
      rmSync(join(rulesDir, 'conventional-commits.md'))

      expect(listInstalledRulesForScope('user')).toEqual([])
    })
  })
})
