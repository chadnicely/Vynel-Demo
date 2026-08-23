// A throwaway real repository for the git-home tests — the readers are
// worth little against a faked git, so they run against the real one in a
// temp folder, signed by a fixed identity so a fresh machine passes too.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

export function makeTestRepository(options: { commit?: boolean } = {}): {
  directory: string
  git: (...args: string[]) => string
  dispose: () => void
} {
  const directory = mkdtempSync(path.join(tmpdir(), 'vynel-git-'))
  const git = (...args: string[]): string =>
    execFileSync(
      'git',
      [
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@localhost',
        '-c',
        'commit.gpgsign=false',
        ...args,
      ],
      { cwd: directory, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    )
  git('init', '-q', '-b', 'main')
  writeFileSync(path.join(directory, 'README.md'), '# test\n')
  if (options.commit !== false) {
    git('add', 'README.md')
    git('commit', '-q', '-m', 'first')
  }
  return {
    directory,
    git,
    dispose: () => rmSync(directory, { recursive: true, force: true, maxRetries: 3 }),
  }
}
