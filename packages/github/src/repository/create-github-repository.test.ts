import { describe, expect, it } from 'vitest'
import { ValidationError } from '@vynel/errors'
import { createGitHubRepository } from './create-github-repository.js'
import { GitHubConnection } from '../github-connection.js'

const INPUT = {
  directory: 'E:\\work\\front-of-house',
  name: 'front-of-house',
  visibility: 'private' as const,
}

describe('createGitHubRepository', () => {
  it('runs ONE gh repo create with the folder as source and reports the URL', async () => {
    const calls: { file: string; args: string[] }[] = []
    const outcome = await createGitHubRepository(INPUT, async (file, args) => {
      calls.push({ file, args })
      return {
        stdout: 'https://github.com/kafijunior/front-of-house\n',
        stderr:
          '✓ Created repository kafijunior/front-of-house on GitHub\n✓ Pushed commits to https://github.com/kafijunior/front-of-house.git\n',
      }
    })
    expect(calls).toEqual([
      {
        file: 'gh',
        args: [
          'repo',
          'create',
          'front-of-house',
          '--private',
          '--source',
          'E:\\work\\front-of-house',
          '--remote',
          'origin',
          '--push',
        ],
      },
    ])
    expect(outcome).toEqual({
      kind: 'created',
      url: 'https://github.com/kafijunior/front-of-house',
    })
  })

  it("reports gh's own last line when the name is taken — never throws", async () => {
    const outcome = await createGitHubRepository({ ...INPUT, visibility: 'public' }, async () => {
      throw Object.assign(new Error('exit 1'), {
        stdout: '',
        stderr: 'GraphQL: Name already exists on this account (createRepository)\n',
      })
    })
    expect(outcome).toEqual({
      kind: 'failed',
      reason: 'GraphQL: Name already exists on this account (createRepository)',
    })
  })

  it('asks for a push-sized timeout, and names a stopped gh as such — not its last progress line', async () => {
    let timeoutMs: number | undefined
    const outcome = await createGitHubRepository(INPUT, async (_file, _args, options) => {
      timeoutMs = options?.timeoutMs
      throw Object.assign(new Error('killed'), {
        killed: true,
        stdout: '',
        stderr: '✓ Created repository sam/front-of-house on GitHub\n',
      })
    })
    expect(timeoutMs).toBe(5 * 60 * 1000)
    expect(outcome).toEqual({
      kind: 'failed',
      reason:
        "gh did not finish within five minutes — check the folder's remote and GitHub before trying again.",
    })
  })

  it('names a missing gh as the reason', async () => {
    const outcome = await createGitHubRepository(INPUT, async () => {
      throw Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT', stdout: '', stderr: '' })
    })
    expect(outcome).toEqual({ kind: 'failed', reason: 'The GitHub CLI (gh) is not installed' })
  })

  it('refuses a name gh would misread (an option, a space) before gh sees it', async () => {
    await expect(
      createGitHubRepository({ ...INPUT, name: '--delete' }, async () => ({
        stdout: '',
        stderr: '',
      })),
    ).rejects.toBeInstanceOf(ValidationError)
    await expect(
      createGitHubRepository({ ...INPUT, name: 'front of house' }, async () => ({
        stdout: '',
        stderr: '',
      })),
    ).rejects.toBeInstanceOf(ValidationError)
  })
})

describe('GitHubConnection.createRepository', () => {
  it('reports "sign in first" as an outcome when gh is signed out, without calling gh repo create', async () => {
    const calls: string[][] = []
    const connection = new GitHubConnection({
      runCommand: async (_file, args) => {
        calls.push(args)
        if (args[0] === 'auth') {
          throw Object.assign(new Error('exit 1'), {
            stdout: '',
            stderr: 'You are not logged into any GitHub hosts.',
          })
        }
        return { stdout: '', stderr: '' }
      },
    })
    expect(await connection.createRepository(INPUT)).toEqual({
      kind: 'failed',
      reason: 'Sign in to GitHub first (Settings → GitHub).',
    })
    expect(calls).toEqual([['auth', 'status']])
  })

  it('creates when signed in', async () => {
    const connection = new GitHubConnection({
      runCommand: async (_file, args) =>
        args[0] === 'auth'
          ? { stdout: '✓ Logged in to github.com account sam (keyring)', stderr: '' }
          : { stdout: 'https://github.com/sam/front-of-house\n', stderr: '' },
    })
    expect(await connection.createRepository(INPUT)).toEqual({
      kind: 'created',
      url: 'https://github.com/sam/front-of-house',
    })
  })
})
