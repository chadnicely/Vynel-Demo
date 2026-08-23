// Creating the GitHub repository for a workspace folder and pushing what is
// there — ONE `gh repo create`, with gh doing the API call, the `origin`
// remote and the first push through the machine's own credential helper.
// Vynel never touches the token. The outcome is REPORTED, never thrown: a
// repository that could not be made leaves the workspace exactly as it was,
// and the person reads why in gh's own words.

import { ValidationError } from '@vynel/errors'
import {
  REPOSITORY_NAME_PATTERN,
  REPOSITORY_NAME_RULE,
  type GitHubRepositoryOutcome,
  type RepositoryVisibility,
} from '@vynel/contracts/github/github-repository'
import {
  defaultCommandRunner,
  GH_NOT_INSTALLED_REASON,
  type CommandRunner,
} from '../auth/github-auth-status.js'
import { lastMeaningfulLine } from '../gh-output.js'

export type CreateGitHubRepositoryInput = {
  /** The workspace folder — must already be a git repository with a commit. */
  directory: string
  name: string
  visibility: RepositoryVisibility
}

const REPOSITORY_URL = /https:\/\/github\.com\/[^\s]+/
// The API call plus a first push of real history over a slow link.
const CREATE_TIMEOUT_MS = 5 * 60 * 1000

const TIMED_OUT_REASON =
  "gh did not finish within five minutes — check the folder's remote and GitHub before trying again."

export async function createGitHubRepository(
  input: CreateGitHubRepositoryInput,
  runCommand: CommandRunner = defaultCommandRunner,
): Promise<GitHubRepositoryOutcome> {
  const name = input.name.trim()
  if (!REPOSITORY_NAME_PATTERN.test(name)) {
    throw new ValidationError(REPOSITORY_NAME_RULE)
  }
  // `--source <folder>` names the repository to push, so no cwd is needed;
  // gh adds the `origin` remote and pushes the current branch with `--push`.
  const args = [
    'repo',
    'create',
    name,
    `--${input.visibility}`,
    '--source',
    input.directory,
    '--remote',
    'origin',
    '--push',
  ]
  try {
    const { stdout, stderr } = await runCommand('gh', args, { timeoutMs: CREATE_TIMEOUT_MS })
    return { kind: 'created', url: REPOSITORY_URL.exec(`${stdout}\n${stderr}`)?.[0] ?? null }
  } catch (error) {
    const failed = error as NodeJS.ErrnoException & {
      stdout?: string
      stderr?: string
      killed?: boolean
    }
    if (failed.code === 'ENOENT') return { kind: 'failed', reason: GH_NOT_INSTALLED_REASON }
    // A stopped gh may have created the repository and set `origin` before the
    // push finished — say that, never its last progress line as if it failed.
    if (failed.killed === true) return { kind: 'failed', reason: TIMED_OUT_REASON }
    return {
      kind: 'failed',
      reason: lastMeaningfulLine(
        `${failed.stdout ?? ''}\n${failed.stderr ?? ''}`,
        'gh could not create the repository',
      ),
    }
  }
}
