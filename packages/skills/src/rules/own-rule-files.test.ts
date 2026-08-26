// The user's OWN rule-file doors over a real isolated home + workspace dir:
// write creates and replaces, saving over a marketplace rule forks it (the
// marker goes, the card stops annotating), delete removes any file the user
// names and 404s on a missing one, and the shared safe-name predicate keeps
// the lister and the writers addressing the same files.

import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withHomeDir } from '../internal/resolve-host-home-dir.js'
import { installRuleFileForScope } from './install-rule-file-for-scope.js'
import { listInstalledRulesForScope } from './list-installed-rules-for-scope.js'
import { listAllRuleFilesForScope } from './list-all-rule-files-for-scope.js'
import { writeOwnRuleFileForScope } from './write-own-rule-file-for-scope.js'
import { deleteOwnRuleFileForScope } from './delete-own-rule-file-for-scope.js'
import { isSafeRuleId } from './resolve-rules-root.js'
import { stripRuleFileMarker } from './rule-file-marker.js'

async function withIsolatedDirs<T>(
  fn: (homeDir: string, workspaceDir: string) => Promise<T>,
): Promise<T> {
  const homeDir = mkdtempSync(join(tmpdir(), 'vynel-own-rules-home-'))
  const workspaceDir = mkdtempSync(join(tmpdir(), 'vynel-own-rules-ws-'))
  try {
    return await withHomeDir(homeDir, () => fn(homeDir, workspaceDir))
  } finally {
    rmSync(homeDir, { recursive: true, force: true })
    rmSync(workspaceDir, { recursive: true, force: true })
  }
}

describe('writeOwnRuleFileForScope', () => {
  it("creates the file (folder included) at user scope and lists it as the user's own", async () => {
    await withIsolatedDirs(async (homeDir) => {
      const { filePath } = await writeOwnRuleFileForScope({
        scope: 'user',
        ruleId: 'git-hygiene',
        content: '# Git hygiene\n\nSmall commits.',
      })
      expect(filePath).toBe(join(homeDir, '.claude', 'rules', 'git-hygiene.md'))
      expect(readFileSync(filePath, 'utf8')).toBe('# Git hygiene\n\nSmall commits.\n')

      const [rule] = listAllRuleFilesForScope('user')
      expect(rule).toMatchObject({
        ruleId: 'git-hygiene',
        title: 'Git hygiene',
        marketplace: null,
      })
    })
  })

  it('workspace scope lands under <workspace>/.claude/rules and replaces on a second write', async () => {
    await withIsolatedDirs(async (_homeDir, workspaceDir) => {
      await writeOwnRuleFileForScope({
        scope: 'workspace',
        workspacePath: workspaceDir,
        ruleId: 'tone',
        content: 'Be warm.',
      })
      await writeOwnRuleFileForScope({
        scope: 'workspace',
        workspacePath: workspaceDir,
        ruleId: 'tone',
        content: 'Be warm and brief.\n\n\n',
      })
      const filePath = join(workspaceDir, '.claude', 'rules', 'tone.md')
      expect(readFileSync(filePath, 'utf8')).toBe('Be warm and brief.\n')
      expect(listAllRuleFilesForScope('user')).toEqual([])
    })
  })

  it('saving over a marketplace rule FORKS it — marker gone, no longer annotates as installed', async () => {
    await withIsolatedDirs(async () => {
      await installRuleFileForScope({
        scope: 'user',
        ruleId: 'conventional-commits',
        version: '1.0.0',
        ruleMarkdown: '# Conventional Commits\n\nUse type(scope): description.',
      })
      expect(listInstalledRulesForScope('user')).toHaveLength(1)

      // The editor round-trips the file's full content, marker line included.
      const [installed] = listAllRuleFilesForScope('user')
      await writeOwnRuleFileForScope({
        scope: 'user',
        ruleId: 'conventional-commits',
        content: `${installed!.content}\nAlso: never force-push.`,
      })

      const [forked] = listAllRuleFilesForScope('user')
      expect(forked!.marketplace).toBeNull()
      expect(forked!.content.startsWith('# Conventional Commits')).toBe(true)
      expect(forked!.content).toContain('never force-push')
      expect(listInstalledRulesForScope('user')).toEqual([])
    })
  })

  it('refuses empty content and an unsafe name', async () => {
    await withIsolatedDirs(async () => {
      await expect(
        writeOwnRuleFileForScope({
          scope: 'user',
          ruleId: 'blank',
          content: '  \n',
        }),
      ).rejects.toMatchObject({ code: 'validation_failed' })
      await expect(
        writeOwnRuleFileForScope({
          scope: 'user',
          ruleId: '../escape',
          content: 'x',
        }),
      ).rejects.toMatchObject({ code: 'validation_failed' })
    })
  })
})

describe('deleteOwnRuleFileForScope', () => {
  it('removes a hand-authored file AND a marketplace-installed one; 404s when missing', async () => {
    await withIsolatedDirs(async (homeDir) => {
      const rulesDir = join(homeDir, '.claude', 'rules')
      mkdirSync(rulesDir, { recursive: true })
      writeFileSync(join(rulesDir, 'mine.md'), '# Mine\n', 'utf8')
      await installRuleFileForScope({
        scope: 'user',
        ruleId: 'theirs',
        version: '2.0.0',
        ruleMarkdown: '# Theirs',
      })

      await deleteOwnRuleFileForScope({ scope: 'user', ruleId: 'mine' })
      await deleteOwnRuleFileForScope({ scope: 'user', ruleId: 'theirs' })
      expect(existsSync(join(rulesDir, 'mine.md'))).toBe(false)
      expect(existsSync(join(rulesDir, 'theirs.md'))).toBe(false)

      await expect(
        deleteOwnRuleFileForScope({ scope: 'user', ruleId: 'mine' }),
      ).rejects.toMatchObject({ code: 'not_found' })
    })
  })
})

describe('the shared safe-name predicate', () => {
  it('accepts what a person would name a file, rejects what could leave the folder', () => {
    expect(isSafeRuleId('git-hygiene')).toBe(true)
    expect(isSafeRuleId('Team Rules')).toBe(true)
    expect(isSafeRuleId('règles')).toBe(true)
    expect(isSafeRuleId('')).toBe(false)
    expect(isSafeRuleId('.hidden')).toBe(false)
    expect(isSafeRuleId('../escape')).toBe(false)
    expect(isSafeRuleId('a/b')).toBe(false)
    expect(isSafeRuleId('a\\b')).toBe(false)
    // Windows-reserved: a colon would write an NTFS alternate data stream.
    for (const reserved of ['foo:bar', 'what?', 'a<b', 'a|b', 'x*', 'say "hi"']) {
      expect(isSafeRuleId(reserved)).toBe(false)
    }
    expect(isSafeRuleId(' padded')).toBe(false)
    expect(isSafeRuleId('x'.repeat(121))).toBe(false)
  })

  it('the lister skips a .md the writers could not address', async () => {
    await withIsolatedDirs(async (homeDir) => {
      const rulesDir = join(homeDir, '.claude', 'rules')
      mkdirSync(rulesDir, { recursive: true })
      writeFileSync(join(rulesDir, '.draft.md'), '# Hidden\n', 'utf8')
      writeFileSync(join(rulesDir, 'Team Rules.md'), '# Team\n', 'utf8')
      expect(listAllRuleFilesForScope('user').map((rule) => rule.ruleId)).toEqual(['Team Rules'])
    })
  })
})

describe('stripRuleFileMarker', () => {
  it('drops the marker line and its blank spacer; leaves unmarked content alone', () => {
    expect(stripRuleFileMarker('<!-- vynel-marketplace-rule: a v1 -->\n\n# A\n')).toBe('# A\n')
    expect(stripRuleFileMarker('<!-- vynel-marketplace-rule: a v1 -->\r\n\r\n# A\r\n')).toBe(
      '# A\r\n',
    )
    expect(stripRuleFileMarker('# Plain\n')).toBe('# Plain\n')
    expect(stripRuleFileMarker('<!-- vynel-marketplace-rule: a v1 -->')).toBe('')
  })
})
