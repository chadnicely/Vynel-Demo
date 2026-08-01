// The registry's ONE git home — every child_process git call the hub makes
// goes through `runGit` (hardened: no ext:: transport, timeout, hidden
// window). Callers: the anthropic import, the upstream-drift watch, and the
// publish-from-repo pipeline. Values that reach argv are validated by the
// caller (sha regexes, ref charset) AND separated with `--` so a hostile
// string can never be parsed as an option.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { rm } from 'node:fs/promises'
import { ValidationError } from '@vynel/errors'

const execFileAsync = promisify(execFile)
const GIT_TIMEOUT_MS = 10 * 60 * 1000

export const GIT_FULL_SHA = /^[0-9a-f]{40}$/

// A git ref we accept from a caller: no leading '-' (argv-option injection),
// conservative charset, bounded length. HEAD, branch names, and tags all fit.
const GIT_REF = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/

/** Run git with the hub's hardening: `protocol.ext.allow=never` blocks the
 *  command-executing ext:: transport — repo values must only ever be a URL
 *  or a path. Returns trimmed stdout. */
export async function runGit(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-c', 'protocol.ext.allow=never', ...args], {
    timeout: GIT_TIMEOUT_MS,
    windowsHide: true,
  })
  return stdout.trim()
}

// Fetch exactly the pinned commit — GitHub serves single-sha fetches, so the
// happy path downloads one tree instead of the repo's history.
export async function cloneRepoAtPin(repo: string, pinnedSha: string, dir: string): Promise<void> {
  if (!GIT_FULL_SHA.test(pinnedSha)) {
    throw new ValidationError(`'${pinnedSha}' is not a full lowercase commit sha.`)
  }
  try {
    await runGit(['init', '--quiet', dir])
    await runGit(['-C', dir, 'fetch', '--quiet', '--depth', '1', '--', repo, pinnedSha])
    await runGit(['-C', dir, 'checkout', '--quiet', 'FETCH_HEAD'])
  } catch {
    // Some servers refuse unadvertised-sha fetches — fall back to a full
    // clone + checkout of the pin (the CLI's original recipe). A failure
    // here propagates with git's own message.
    await rm(dir, { recursive: true, force: true })
    await runGit(['clone', '--quiet', '--', repo, dir])
    await runGit(['-C', dir, 'checkout', '--quiet', pinnedSha])
  }
}

/**
 * Resolve a ref (branch, tag, or HEAD) to the full commit sha it points at —
 * the resolve-then-pin step, so everything after it works on an immutable
 * snapshot. A full sha passes through untouched (no network). Returns null
 * when the remote doesn't advertise the ref.
 */
export async function resolveRepoRefToSha(repo: string, ref: string): Promise<string | null> {
  if (GIT_FULL_SHA.test(ref)) return ref
  if (!GIT_REF.test(ref)) {
    throw new ValidationError(
      `'${ref}' is not a usable git ref — use a branch, a tag, or a full 40-hex commit sha.`,
    )
  }
  const listing = await runGit(['ls-remote', '--', repo, ref, `${ref}^{}`])
  const advertised = new Map<string, string>()
  for (const line of listing.split('\n')) {
    const [sha, refName] = line.split('\t')
    if (sha !== undefined && refName !== undefined && GIT_FULL_SHA.test(sha)) {
      advertised.set(refName, sha)
    }
  }
  // Peeled tag first (the commit behind an annotated tag), then the tag or
  // branch itself, then whatever exact name the caller gave (HEAD included).
  return (
    advertised.get(`refs/tags/${ref}^{}`) ??
    advertised.get(`refs/tags/${ref}`) ??
    advertised.get(`refs/heads/${ref}`) ??
    advertised.get(ref) ??
    null
  )
}
